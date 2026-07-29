package llm

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/codefun/tagmanager/backend/internal/config"
	"github.com/codefun/tagmanager/backend/internal/domain"
)

type OpenAICompatibleClient struct {
	baseURL, apiKey, model string
	client                 *http.Client
	logger                 *slog.Logger
}

func NewOpenAICompatible(cfg config.LLMConfig, logger *slog.Logger) *OpenAICompatibleClient {
	if logger == nil {
		logger = slog.Default()
	}
	return &OpenAICompatibleClient{
		baseURL: strings.TrimRight(cfg.BaseURL, "/"),
		apiKey:  cfg.APIKey,
		model:   cfg.Model,
		client:  &http.Client{Timeout: cfg.Timeout},
		logger:  logger,
	}
}

func (c *OpenAICompatibleClient) Consolidate(ctx context.Context, input ConsolidationRequest) (domain.ConsolidationOutput, error) {
	if c.baseURL == "" || c.apiKey == "" || c.model == "" {
		return domain.ConsolidationOutput{}, fmt.Errorf("LLM provider is not configured")
	}

	url := c.baseURL + "/chat/completions"
	body, err := c.buildRequestBody(input, true)
	if err != nil {
		return domain.ConsolidationOutput{}, err
	}

	c.logger.Info("llm request starting",
		"url", url,
		"model", c.model,
		"entries", len(input.Entries),
		"timeout", c.client.Timeout.String(),
		"stream", true,
		"payloadBytes", len(body),
	)
	started := time.Now()

	content, err := c.doStream(ctx, url, body, len(input.Entries))
	if err != nil {
		// Some OpenAI-compatible stacks reject stream+json_schema; fall back once.
		if isStreamUnsupported(err) {
			c.logger.Warn("llm streaming unsupported, falling back to non-stream", "error", err)
			body, err = c.buildRequestBody(input, false)
			if err != nil {
				return domain.ConsolidationOutput{}, err
			}
			content, err = c.doNonStream(ctx, url, body, len(input.Entries))
		}
		if err != nil {
			return domain.ConsolidationOutput{}, fmt.Errorf("LLM request to %s failed (timeout %s, model %s, %d entries, elapsed %s): %w",
				url, c.client.Timeout, c.model, len(input.Entries), time.Since(started).Round(time.Millisecond), err)
		}
	}

	output, err := parseConsolidationContent(content)
	if err != nil {
		return domain.ConsolidationOutput{}, err
	}
	c.logger.Info("llm request completed",
		"model", c.model,
		"entries", len(input.Entries),
		"tags", len(output.Tags),
		"contentBytes", len(content),
		"elapsed", time.Since(started).Round(time.Millisecond).String(),
	)
	return output, nil
}

func (c *OpenAICompatibleClient) buildRequestBody(input ConsolidationRequest, stream bool) ([]byte, error) {
	prompt, err := json.Marshal(input)
	if err != nil {
		return nil, err
	}
	schema := map[string]any{
		"type":                 "object",
		"additionalProperties": false,
		"properties": map[string]any{
			"tags": map[string]any{
				"type": "array",
				"items": map[string]any{
					"type":                 "object",
					"additionalProperties": false,
					"properties": map[string]any{
						"canonicalName": map[string]any{"type": "string"},
						"description":   map[string]any{"type": "string"},
						"aliases":       map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
						"coveredIds":    map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
						"rationale":     map[string]any{"type": "string"},
						"confidence":    map[string]any{"type": "number"},
					},
					"required": []string{"canonicalName", "description", "aliases", "coveredIds", "rationale", "confidence"},
				},
			},
		},
		"required": []string{"tags"},
	}
	body := map[string]any{
		"model":       c.model,
		"temperature": 0,
		"stream":      stream,
		"response_format": map[string]any{
			"type": "json_schema",
			"json_schema": map[string]any{
				"name":   "tag_consolidation",
				"strict": true,
				"schema": schema,
			},
		},
		"messages": []map[string]string{
			{"role": "system", "content": "You consolidate raw business tags into a minimal, reviewable taxonomy increment. You are provided with `existingTags` (already published canonical tag names in this namespace) and `entries` (unresolved raw candidate tags, each having an `id`, `name`, and `occurrences`). CRITICAL: In `coveredIds`, you MUST list the exact `id` strings of all candidate entries in `entries` that are covered or mapped by this proposed tag. Do NOT leave `coveredIds` empty. Every entry `id` from `entries` must appear in exactly one tag's `coveredIds` array. Never invent fake IDs. Prefer mapping candidate entries to existing published tags in `existingTags` as new aliases, or reusing an existing canonicalName, rather than creating redundant new canonical tags whenever an existing tag matches the semantic intent. In `aliases`, include ONLY newly proposed alias names for this batch—do NOT include existing canonical tag names or previously published aliases. Return only JSON matching the schema."},
			{"role": "user", "content": string(prompt)},
		},
	}
	return json.Marshal(body)
}

func (c *OpenAICompatibleClient) doStream(ctx context.Context, url string, body []byte, entryCount int) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")

	headersAt := time.Now()
	response, err := c.client.Do(req)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()

	c.logger.Info("llm response headers received",
		"status", response.StatusCode,
		"contentType", response.Header.Get("Content-Type"),
		"ttfb", time.Since(headersAt).Round(time.Millisecond).String(),
		"entries", entryCount,
	)

	if response.StatusCode < 200 || response.StatusCode > 299 {
		payload, _ := io.ReadAll(io.LimitReader(response.Body, 4<<20))
		return "", fmt.Errorf("LLM returned %s: %s", response.Status, string(payload))
	}

	// Some servers ignore stream=true and still return a normal JSON body.
	ct := strings.ToLower(response.Header.Get("Content-Type"))
	if strings.Contains(ct, "application/json") && !strings.Contains(ct, "event-stream") {
		payload, err := io.ReadAll(io.LimitReader(response.Body, 4<<20))
		if err != nil {
			return "", err
		}
		c.logger.Info("llm returned non-stream JSON body despite stream=true", "bytes", len(payload))
		return extractContentFromCompletionJSON(payload)
	}

	return c.readSSE(response.Body)
}

func (c *OpenAICompatibleClient) doNonStream(ctx context.Context, url string, body []byte, entryCount int) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")

	headersAt := time.Now()
	response, err := c.client.Do(req)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()

	c.logger.Info("llm non-stream response headers received",
		"status", response.StatusCode,
		"ttfb", time.Since(headersAt).Round(time.Millisecond).String(),
		"entries", entryCount,
	)

	payload, _ := io.ReadAll(io.LimitReader(response.Body, 4<<20))
	if response.StatusCode < 200 || response.StatusCode > 299 {
		return "", fmt.Errorf("LLM returned %s: %s", response.Status, string(payload))
	}
	return extractContentFromCompletionJSON(payload)
}

func (c *OpenAICompatibleClient) readSSE(body io.Reader) (string, error) {
	scanner := bufio.NewScanner(body)
	// Structured consolidation can emit large single SSE lines.
	buf := make([]byte, 0, 64*1024)
	scanner.Buffer(buf, 2<<20)

	var content strings.Builder
	chunks := 0
	firstTokenAt := time.Time{}
	lastLogAt := time.Now()
	started := time.Now()

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, ":") {
			continue
		}
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "" {
			continue
		}
		if data == "[DONE]" {
			break
		}

		var piece streamChunk
		if err := json.Unmarshal([]byte(data), &piece); err != nil {
			// Keep going; some providers send non-delta events.
			c.logger.Debug("llm sse chunk not json", "data", truncate(data, 200))
			continue
		}
		delta := piece.deltaContent()
		if delta == "" {
			continue
		}
		if firstTokenAt.IsZero() {
			firstTokenAt = time.Now()
			c.logger.Info("llm first token received",
				"ttft", firstTokenAt.Sub(started).Round(time.Millisecond).String(),
			)
		}
		content.WriteString(delta)
		chunks++

		if time.Since(lastLogAt) >= 5*time.Second {
			c.logger.Info("llm stream progress",
				"chunks", chunks,
				"contentBytes", content.Len(),
				"elapsed", time.Since(started).Round(time.Millisecond).String(),
				"preview", truncate(content.String(), 120),
			)
			lastLogAt = time.Now()
		}
	}
	if err := scanner.Err(); err != nil {
		return "", fmt.Errorf("read SSE stream: %w", err)
	}
	if content.Len() == 0 {
		return "", fmt.Errorf("LLM stream completed with empty content (%d chunks)", chunks)
	}
	c.logger.Info("llm stream finished",
		"chunks", chunks,
		"contentBytes", content.Len(),
		"elapsed", time.Since(started).Round(time.Millisecond).String(),
	)
	return content.String(), nil
}

type streamChunk struct {
	Choices []struct {
		Delta struct {
			Content string `json:"content"`
		} `json:"delta"`
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
}

func (c streamChunk) deltaContent() string {
	if len(c.Choices) == 0 {
		return ""
	}
	if c.Choices[0].Delta.Content != "" {
		return c.Choices[0].Delta.Content
	}
	return c.Choices[0].Message.Content
}

func extractContentFromCompletionJSON(payload []byte) (string, error) {
	var decoded struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(payload, &decoded); err != nil {
		return "", err
	}
	if len(decoded.Choices) == 0 {
		return "", fmt.Errorf("LLM returned no choices")
	}
	return decoded.Choices[0].Message.Content, nil
}

func parseConsolidationContent(content string) (domain.ConsolidationOutput, error) {
	cleaned := strings.TrimSpace(content)
	cleaned = strings.TrimPrefix(cleaned, "```json")
	cleaned = strings.TrimPrefix(cleaned, "```JSON")
	cleaned = strings.TrimPrefix(cleaned, "```")
	cleaned = strings.TrimSuffix(cleaned, "```")
	cleaned = strings.TrimSpace(cleaned)

	var output domain.ConsolidationOutput
	if err := json.Unmarshal([]byte(cleaned), &output); err != nil {
		return domain.ConsolidationOutput{}, fmt.Errorf("invalid LLM structured output: %w; preview=%q", err, truncate(cleaned, 240))
	}
	return output, nil
}

func isStreamUnsupported(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "stream") &&
		(strings.Contains(msg, "400") ||
			strings.Contains(msg, "unsupported") ||
			strings.Contains(msg, "not support") ||
			strings.Contains(msg, "invalid") ||
			strings.Contains(msg, "json_schema"))
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
