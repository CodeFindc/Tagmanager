package llm

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
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
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = 600 * time.Second
	}
	tr := &http.Transport{
		Proxy:                 http.ProxyFromEnvironment,
		ResponseHeaderTimeout: 120 * time.Second,
		IdleConnTimeout:       90 * time.Second,
	}
	return &OpenAICompatibleClient{
		baseURL: strings.TrimRight(cfg.BaseURL, "/"),
		apiKey:  cfg.APIKey,
		model:   cfg.Model,
		client: &http.Client{
			Timeout:   timeout,
			Transport: tr,
		},
		logger: logger,
	}
}

func (c *OpenAICompatibleClient) Consolidate(ctx context.Context, input ConsolidationRequest) (domain.ConsolidationOutput, error) {
	if c.baseURL == "" || c.apiKey == "" || c.model == "" {
		return domain.ConsolidationOutput{}, fmt.Errorf("LLM provider is not configured")
	}

	url := c.baseURL + "/chat/completions"
	body, err := c.buildRequestBody(input, true, true)
	if err != nil {
		return domain.ConsolidationOutput{}, err
	}

	c.logger.Info("llm request starting",
		"url", url,
		"model", c.model,
		"entries", len(input.Entries),
		"timeout", c.client.Timeout.String(),
		"stream", true,
		"jsonSchema", true,
		"payloadBytes", len(body),
	)
	started := time.Now()

	content, err := c.doStream(ctx, url, body, len(input.Entries))
	if err != nil {
		// Some OpenAI-compatible stacks hang or fail with stream+json_schema; fall back without strict json_schema.
		if isStreamOrSchemaUnsupported(err) {
			c.logger.Warn("llm streaming with strict json_schema failed/timed out, falling back without strict json_schema", "error", err)
			body, err = c.buildRequestBody(input, true, false)
			if err == nil {
				content, err = c.doStream(ctx, url, body, len(input.Entries))
			}
			if err != nil {
				c.logger.Warn("llm streaming fallback failed, falling back to non-stream", "error", err)
				body, err = c.buildRequestBody(input, false, false)
				if err == nil {
					content, err = c.doNonStream(ctx, url, body, len(input.Entries))
				}
			}
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

func (c *OpenAICompatibleClient) buildRequestBody(input ConsolidationRequest, stream bool, useSchema bool) ([]byte, error) {
	prompt, err := json.Marshal(input)
	if err != nil {
		return nil, err
	}
	body := map[string]any{
		"model":       c.model,
		"temperature": 0,
		"stream":      stream,
		"messages": []map[string]string{
			{"role": "system", "content": "You consolidate raw business tags into a minimal, reviewable taxonomy increment. You are provided with `existingTags` (already published canonical tag names in this namespace) and `entries` (unresolved raw candidate tags, each having an `id`, `name`, and `occurrences`). CRITICAL: In `coveredIds`, you MUST list the exact `id` strings of all candidate entries in `entries` that are covered or mapped by this proposed tag. Do NOT leave `coveredIds` empty. Every entry `id` from `entries` must appear in exactly one tag's `coveredIds` array. Never invent fake IDs. Prefer mapping candidate entries to existing published tags in `existingTags` as new aliases, or reusing an existing canonicalName, rather than creating redundant new canonical tags whenever an existing tag matches the semantic intent. In `aliases`, include ONLY newly proposed alias names for this batch—do NOT include existing canonical tag names or previously published aliases. Return ONLY valid JSON matching structure: {\"tags\":[{\"canonicalName\":string,\"description\":string,\"aliases\":[string],\"coveredIds\":[string],\"rationale\":string,\"confidence\":number}]}."},
			{"role": "user", "content": string(prompt)},
		},
	}
	if useSchema {
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
		body["response_format"] = map[string]any{
			"type": "json_schema",
			"json_schema": map[string]any{
				"name":   "tag_consolidation",
				"strict": true,
				"schema": schema,
			},
		}
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
	// Wrap with 300s TTFT timeout for long GPU prefill on 27B+ models
	scanner := bufio.NewScanner(newTTFTReader(body, 300*time.Second))
	// Structured consolidation can emit large single SSE lines.
	buf := make([]byte, 0, 64*1024)
	scanner.Buffer(buf, 2<<20)

	var content strings.Builder
	var reasoningContent strings.Builder
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
		deltaText, isReasoning := piece.deltaContent()
		if deltaText == "" {
			continue
		}
		if firstTokenAt.IsZero() {
			firstTokenAt = time.Now()
			c.logger.Info("llm first token received",
				"ttft", firstTokenAt.Sub(started).Round(time.Millisecond).String(),
				"isReasoning", isReasoning,
			)
		}
		chunks++

		if isReasoning {
			reasoningContent.WriteString(deltaText)
			c.logger.Info("llm token [thinking]", "chunk", chunks, "delta", deltaText)
		} else {
			content.WriteString(deltaText)
			c.logger.Info("llm token [content]", "chunk", chunks, "delta", deltaText)
		}

		if time.Since(lastLogAt) >= 3*time.Second {
			if content.Len() > 0 {
				c.logger.Info("llm stream progress summary",
					"chunks", chunks,
					"contentBytes", content.Len(),
					"elapsed", time.Since(started).Round(time.Millisecond).String(),
					"totalContent", truncate(content.String(), 200),
				)
			} else if reasoningContent.Len() > 0 {
				c.logger.Info("llm reasoning progress summary",
					"chunks", chunks,
					"reasoningBytes", reasoningContent.Len(),
					"elapsed", time.Since(started).Round(time.Millisecond).String(),
					"totalReasoning", truncate(reasoningContent.String(), 200),
				)
			}
			lastLogAt = time.Now()
		}
	}
	if err := scanner.Err(); err != nil {
		if errors.Is(err, context.DeadlineExceeded) || strings.Contains(err.Error(), "context deadline exceeded") || strings.Contains(err.Error(), "Client.Timeout") {
			return "", fmt.Errorf("大模型生成流响应超时 (read SSE stream: %w)。提示：大模型对较大批次候选词的结构化归并生成耗时较长，请前往【设置中心】增大超时时间(TimeoutSeconds，建议 600 秒以上)或调小候选池触发阈值", err)
		}
		return "", fmt.Errorf("read SSE stream: %w", err)
	}
	if content.Len() == 0 {
		if reasoningContent.Len() > 0 {
			return "", fmt.Errorf("LLM 输出了思考过程但未输出最终 content (%d chunks)", chunks)
		}
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
			Content          string `json:"content"`
			ReasoningContent string `json:"reasoning_content"`
		} `json:"delta"`
		Message struct {
			Content          string `json:"content"`
			ReasoningContent string `json:"reasoning_content"`
		} `json:"message"`
	} `json:"choices"`
}

func (c streamChunk) deltaContent() (string, bool) {
	if len(c.Choices) == 0 {
		return "", false
	}
	ch := c.Choices[0]
	if ch.Delta.Content != "" {
		return ch.Delta.Content, false
	}
	if ch.Message.Content != "" {
		return ch.Message.Content, false
	}
	if ch.Delta.ReasoningContent != "" {
		return ch.Delta.ReasoningContent, true
	}
	if ch.Message.ReasoningContent != "" {
		return ch.Message.ReasoningContent, true
	}
	return "", false
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

func isStreamOrSchemaUnsupported(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "stream") ||
		strings.Contains(msg, "json_schema") ||
		strings.Contains(msg, "response_format") ||
		strings.Contains(msg, "guided_decoding") ||
		strings.Contains(msg, "grammar") ||
		strings.Contains(msg, "ttft") ||
		strings.Contains(msg, "wait first token timeout") ||
		strings.Contains(msg, "400") ||
		strings.Contains(msg, "unsupported") ||
		strings.Contains(msg, "not support") ||
		strings.Contains(msg, "invalid")
}

type ttftReader struct {
	reader       io.Reader
	ttftTimeout  time.Duration
	gotFirstByte bool
}

func newTTFTReader(r io.Reader, timeout time.Duration) *ttftReader {
	return &ttftReader{reader: r, ttftTimeout: timeout}
}

func (tr *ttftReader) Read(p []byte) (int, error) {
	if !tr.gotFirstByte {
		type readRes struct {
			n   int
			err error
		}
		ch := make(chan readRes, 1)
		go func() {
			n, err := tr.reader.Read(p)
			ch <- readRes{n, err}
		}()
		select {
		case res := <-ch:
			if res.n > 0 {
				tr.gotFirstByte = true
			}
			return res.n, res.err
		case <-time.After(tr.ttftTimeout):
			return 0, fmt.Errorf("wait first token timeout (TTFT > %v)", tr.ttftTimeout)
		}
	}
	return tr.reader.Read(p)
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

func (c *OpenAICompatibleClient) EvaluateProposal(ctx context.Context, cfg domain.AIAuditConfig, proposal domain.Proposal, candidateEntries []string) (domain.AIAuditEvaluateResponse, error) {
	baseURL := strings.TrimRight(cfg.BaseURL, "/")
	if baseURL == "" {
		baseURL = c.baseURL
	}
	apiKey := cfg.APIKey
	if apiKey == "" {
		apiKey = c.apiKey
	}
	model := cfg.Model
	if model == "" {
		model = c.model
	}

	if baseURL == "" || apiKey == "" || model == "" {
		return domain.AIAuditEvaluateResponse{}, fmt.Errorf("AI 助审大模型未配置（缺少 BaseURL、APIKey 或 Model）")
	}

	sysPrompt := cfg.Prompt
	if strings.TrimSpace(sysPrompt) == "" {
		sysPrompt = "你是一名严谨的企业级标签体系审核专家。你的任务是评估大模型自动总结产生的【待审核标签提案】。你需要针对提案中的每一个拟发布规范标签及其别名、受支撑涵盖候选词进行质量诊断与冲突排查，给出现场审核改进建议。请严格按照 JSON Schema 格式返回 JSON 结果。"
	}

	type tagSummary struct {
		CanonicalName       string   `json:"canonicalName"`
		Description         string   `json:"description"`
		Aliases             []string `json:"aliases"`
		Confidence          float64  `json:"confidence"`
		IsExistingCanonical bool     `json:"isExistingCanonical"`
		CoveredEntryCount   int      `json:"coveredEntryCount"`
	}

	tags := []tagSummary{}
	for _, t := range proposal.Tags {
		tags = append(tags, tagSummary{
			CanonicalName:       t.CanonicalName,
			Description:         t.Description,
			Aliases:             t.Aliases,
			Confidence:          t.Confidence,
			IsExistingCanonical: t.IsExistingCanonical,
			CoveredEntryCount:   len(t.CoveredEntryIDs),
		})
	}

	samples := candidateEntries
	if len(samples) > 30 {
		samples = samples[:30]
	}

	userPayload, _ := json.Marshal(map[string]any{
		"proposedTags":     tags,
		"candidateSamples": samples,
	})

	schema := map[string]any{
		"type": "object",
		"properties": map[string]any{
			"overallSummary": map[string]any{"type": "string", "description": "总体审核评估诊断与改进建议总结（100字以内）"},
			"tagAdvice": map[string]any{
				"type": "array",
				"items": map[string]any{
					"type": "object",
					"properties": map[string]any{
						"canonicalName":  map[string]any{"type": "string"},
						"recommendation": map[string]any{"type": "string", "enum": []string{"accept", "edit", "reject"}, "description": "处理建议：accept（建议采纳）、edit（建议调整）、reject（建议忽略）"},
						"reason":         map[string]any{"type": "string", "description": "做出该评估的具体理由（30字以内）"},
						"suggestedName":  map[string]any{"type": "string", "description": "可选：当建议修改时，推荐的更优规范名"},
					},
					"required": []string{"canonicalName", "recommendation", "reason"},
				},
			},
		},
		"required": []string{"overallSummary", "tagAdvice"},
	}

	reqBodyMap := map[string]any{
		"model":       model,
		"temperature": 0.2,
		"max_tokens":  8192,
		"messages": []map[string]string{
			{"role": "system", "content": sysPrompt},
			{"role": "user", "content": string(userPayload)},
		},
		"response_format": map[string]any{
			"type": "json_schema",
			"json_schema": map[string]any{
				"name":   "ai_audit_response",
				"strict": true,
				"schema": schema,
			},
		},
	}

	reqBodyBytes, err := json.Marshal(reqBodyMap)
	if err != nil {
		return domain.AIAuditEvaluateResponse{}, err
	}

	url := baseURL + "/chat/completions"
	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(reqBodyBytes))
	if err != nil {
		return domain.AIAuditEvaluateResponse{}, err
	}
	httpReq.Header.Set("Authorization", "Bearer "+apiKey)
	httpReq.Header.Set("Content-Type", "application/json")

	timeout := 600 * time.Second
	if cfg.TimeoutSeconds > 0 {
		tSec := cfg.TimeoutSeconds
		if tSec < 300 {
			tSec = 300
		}
		timeout = time.Duration(tSec) * time.Second
	}
	tr := &http.Transport{
		Proxy:                 http.ProxyFromEnvironment,
		ResponseHeaderTimeout: 120 * time.Second,
		IdleConnTimeout:       90 * time.Second,
	}
	client := &http.Client{
		Timeout:   timeout,
		Transport: tr,
	}
	resp, err := client.Do(httpReq)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) || strings.Contains(err.Error(), "context deadline exceeded") || strings.Contains(err.Error(), "Client.Timeout") {
			return domain.AIAuditEvaluateResponse{}, fmt.Errorf("AI 助审大模型响应超时 (超过 %d 秒未返回)。提示：模型对较多提案标签评估生成耗时较长，请前往【设置中心】增大超时时间(TimeoutSeconds，建议 600 秒以上)", int(timeout.Seconds()))
		}
		return domain.AIAuditEvaluateResponse{}, fmt.Errorf("请求 AI 助审 Endpoint (%s) 失败: %w", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBytes, _ := io.ReadAll(resp.Body)
		return domain.AIAuditEvaluateResponse{}, fmt.Errorf("AI 助审 Endpoint 返回错误状态码 %d: %s", resp.StatusCode, truncate(string(respBytes), 200))
	}

	var chatResp struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&chatResp); err != nil {
		return domain.AIAuditEvaluateResponse{}, err
	}

	if len(chatResp.Choices) == 0 {
		return domain.AIAuditEvaluateResponse{}, fmt.Errorf("AI 助审服务未返回有效 Choices")
	}

	var result domain.AIAuditEvaluateResponse
	rawContent := strings.TrimSpace(chatResp.Choices[0].Message.Content)
	if err := json.Unmarshal([]byte(rawContent), &result); err != nil {
		return domain.AIAuditEvaluateResponse{}, fmt.Errorf("解析 AI 助审响应 JSON 失败: %w", err)
	}

	return result, nil
}

func (c *OpenAICompatibleClient) EvaluateProposalStream(ctx context.Context, cfg domain.AIAuditConfig, proposal domain.Proposal, candidateEntries []string, onChunk func(string)) (domain.AIAuditEvaluateResponse, error) {
	baseURL := strings.TrimRight(cfg.BaseURL, "/")
	if baseURL == "" {
		baseURL = c.baseURL
	}
	apiKey := cfg.APIKey
	if apiKey == "" {
		apiKey = c.apiKey
	}
	model := cfg.Model
	if model == "" {
		model = c.model
	}

	if baseURL == "" || apiKey == "" || model == "" {
		return domain.AIAuditEvaluateResponse{}, fmt.Errorf("AI 助审大模型未配置（缺少 BaseURL、APIKey 或 Model）")
	}

	sysPrompt := cfg.Prompt
	if strings.TrimSpace(sysPrompt) == "" {
		sysPrompt = "你是一名严谨的企业级标签体系审核专家。你的任务是评估大模型自动总结产生的【待审核标签提案】。你需要针对提案中的每一个拟发布规范标签及其别名、受支撑涵盖候选词进行质量诊断与冲突排查，给出现场审核改进建议。请严格按照 JSON Schema 格式返回 JSON 结果。"
	}

	type tagSummary struct {
		CanonicalName       string   `json:"canonicalName"`
		Description         string   `json:"description"`
		Aliases             []string `json:"aliases"`
		Confidence          float64  `json:"confidence"`
		IsExistingCanonical bool     `json:"isExistingCanonical"`
		CoveredEntryCount   int      `json:"coveredEntryCount"`
	}

	tags := []tagSummary{}
	for _, t := range proposal.Tags {
		tags = append(tags, tagSummary{
			CanonicalName:       t.CanonicalName,
			Description:         t.Description,
			Aliases:             t.Aliases,
			Confidence:          t.Confidence,
			IsExistingCanonical: t.IsExistingCanonical,
			CoveredEntryCount:   len(t.CoveredEntryIDs),
		})
	}

	samples := candidateEntries
	if len(samples) > 30 {
		samples = samples[:30]
	}

	userPayload, _ := json.Marshal(map[string]any{
		"proposedTags":     tags,
		"candidateSamples": samples,
	})

	schema := map[string]any{
		"type": "object",
		"properties": map[string]any{
			"overallSummary": map[string]any{"type": "string", "description": "总体审核评估诊断与改进建议总结（100字以内）"},
			"tagAdvice": map[string]any{
				"type": "array",
				"items": map[string]any{
					"type": "object",
					"properties": map[string]any{
						"canonicalName":  map[string]any{"type": "string"},
						"recommendation": map[string]any{"type": "string", "enum": []string{"accept", "edit", "reject"}, "description": "处理建议：accept（建议采纳）、edit（建议调整）、reject（建议忽略）"},
						"reason":         map[string]any{"type": "string", "description": "做出该评估的具体理由（30字以内）"},
						"suggestedName":  map[string]any{"type": "string", "description": "可选：当建议修改时，推荐的更优规范名"},
					},
					"required": []string{"canonicalName", "recommendation", "reason"},
				},
			},
		},
		"required": []string{"overallSummary", "tagAdvice"},
	}

	reqBodyMap := map[string]any{
		"model":       model,
		"stream":      true,
		"temperature": 0.2,
		"max_tokens":  8192,
		"messages": []map[string]string{
			{"role": "system", "content": sysPrompt},
			{"role": "user", "content": string(userPayload)},
		},
		"response_format": map[string]any{
			"type": "json_schema",
			"json_schema": map[string]any{
				"name":   "ai_audit_response",
				"strict": true,
				"schema": schema,
			},
		},
	}

	reqBodyBytes, err := json.Marshal(reqBodyMap)
	if err != nil {
		return domain.AIAuditEvaluateResponse{}, err
	}

	url := baseURL + "/chat/completions"
	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(reqBodyBytes))
	if err != nil {
		return domain.AIAuditEvaluateResponse{}, err
	}
	httpReq.Header.Set("Authorization", "Bearer "+apiKey)
	httpReq.Header.Set("Content-Type", "application/json")

	timeout := 300 * time.Second
	if cfg.TimeoutSeconds > 0 {
		timeout = time.Duration(cfg.TimeoutSeconds) * time.Second
	}
	client := &http.Client{Timeout: timeout}
	resp, err := client.Do(httpReq)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) || strings.Contains(err.Error(), "Client.Timeout") {
			return domain.AIAuditEvaluateResponse{}, fmt.Errorf("AI 助审大模型响应超时 (超过 %d 秒未返回)。建议更换更快的模型或检查大模型服务状态", int(timeout.Seconds()))
		}
		return domain.AIAuditEvaluateResponse{}, fmt.Errorf("请求 AI 助审 Endpoint (%s) 失败: %w", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return c.EvaluateProposal(ctx, cfg, proposal, candidateEntries)
	}

	var fullContent strings.Builder
	scanner := bufio.NewScanner(resp.Body)
	buf := make([]byte, 64*1024)
	scanner.Buffer(buf, 10*1024*1024)

	for scanner.Scan() {
		line := scanner.Text()
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "[DONE]" {
			break
		}
		var streamResp struct {
			Choices []struct {
				Delta struct {
					Content string `json:"content"`
				} `json:"delta"`
			} `json:"choices"`
		}
		if err := json.Unmarshal([]byte(data), &streamResp); err == nil && len(streamResp.Choices) > 0 {
			content := streamResp.Choices[0].Delta.Content
			if content != "" {
				fullContent.WriteString(content)
				if onChunk != nil {
					onChunk(content)
				}
			}
		}
	}

	if fullContent.Len() == 0 {
		return c.EvaluateProposal(ctx, cfg, proposal, candidateEntries)
	}

	rawContent := strings.TrimSpace(fullContent.String())
	rawContent = strings.TrimPrefix(rawContent, "```json")
	rawContent = strings.TrimPrefix(rawContent, "```")
	rawContent = strings.TrimSuffix(rawContent, "```")
	rawContent = strings.TrimSpace(rawContent)

	var result domain.AIAuditEvaluateResponse
	if err := json.Unmarshal([]byte(rawContent), &result); err != nil {
		endSnippet := rawContent
		if len(endSnippet) > 120 {
			endSnippet = "…" + endSnippet[len(endSnippet)-120:]
		}
		return domain.AIAuditEvaluateResponse{}, fmt.Errorf("解析流式 AI 助审响应 JSON 失败: %w (尾部内容: %s)", err, endSnippet)
	}

	return result, nil
}

func (c *OpenAICompatibleClient) FetchModels(ctx context.Context, baseURL, apiKey string) ([]string, error) {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	apiKey = strings.TrimSpace(apiKey)
	if baseURL == "" {
		baseURL = c.baseURL
	}
	if apiKey == "" {
		apiKey = c.apiKey
	}
	if baseURL == "" || apiKey == "" {
		return nil, fmt.Errorf("BaseURL 和 APIKey 为必填项，无法获取模型列表")
	}

	url := baseURL + "/models"
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Accept", "application/json")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("无法连接到 %s: %w", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("Endpoint 返回错误状态码 %d: %s", resp.StatusCode, truncate(string(body), 200))
	}

	var res struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&res); err != nil {
		return nil, fmt.Errorf("解析模型列表 JSON 失败: %w", err)
	}

	models := make([]string, 0, len(res.Data))
	for _, m := range res.Data {
		if strings.TrimSpace(m.ID) != "" {
			models = append(models, m.ID)
		}
	}
	return models, nil
}

func (c *OpenAICompatibleClient) TestConnection(ctx context.Context, cfg domain.TestLLMRequest) (int64, error) {
	baseURL := strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/")
	apiKey := strings.TrimSpace(cfg.APIKey)
	model := strings.TrimSpace(cfg.Model)
	if baseURL == "" {
		baseURL = c.baseURL
	}
	if apiKey == "" {
		apiKey = c.apiKey
	}
	if model == "" {
		model = c.model
	}

	if baseURL == "" || apiKey == "" || model == "" {
		return 0, fmt.Errorf(" BaseURL、APIKey 与 Model 为必填项，无法发起连接测试")
	}

	reqBody := map[string]any{
		"model": model,
		"messages": []map[string]string{
			{"role": "user", "content": "ping"},
		},
		"max_tokens": 1,
	}
	bodyBytes, err := json.Marshal(reqBody)
	if err != nil {
		return 0, err
	}

	url := baseURL + "/chat/completions"
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(bodyBytes))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 15 * time.Second}
	started := time.Now()
	resp, err := client.Do(req)
	latency := time.Since(started).Milliseconds()
	if err != nil {
		return latency, fmt.Errorf("连接失败: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBytes, _ := io.ReadAll(resp.Body)
		return latency, fmt.Errorf("返回错误状态码 %d: %s", resp.StatusCode, truncate(string(respBytes), 200))
	}
	return latency, nil
}

func (c *OpenAICompatibleClient) ExtractTagFromText(ctx context.Context, req domain.ExtractTagRequest) (domain.ExtractTagResponse, error) {
	text := strings.TrimSpace(req.Text)
	if text == "" {
		return domain.ExtractTagResponse{}, fmt.Errorf("文本内容不能为空")
	}

	nsName := req.NamespaceName
	if nsName == "" {
		nsName = "通用业务标签域"
	}

	if c.baseURL == "" || c.apiKey == "" || c.model == "" {
		return domain.ExtractTagResponse{}, fmt.Errorf("LLM 模型未配置，请先进入【设置中心】配置 Base URL、API Key 与 Model 名称")
	}

	sysPrompt := "你是一名企业级标签体系归纳与特征抽取专家。"
	userPrompt := fmt.Sprintf(`当前所属标签业务域：%s。
你的任务是：深入分析下方给出的详细事件事情描述大段文本，抽取并归纳出一个最简练、精准、标准化的规范标签短语（例如“违规空域无人机黑飞”、“自行车与机动车碰撞”等，控制在 15 个字以内）。

事件文本描述：
%s

请严格按照 JSON 格式返回 JSON 对象，不要包含 markdown 标记或除 JSON 以外的任何文字：
{"extractedTag": "提取出的规范标签短语", "reasoning": "简要提取理由与核心特征归纳"}`, nsName, text)

	type openAIMessage struct {
		Role    string `json:"role"`
		Content string `json:"content"`
	}
	type openAIRequest struct {
		Model       string          `json:"model"`
		Temperature float64         `json:"temperature"`
		Messages    []openAIMessage `json:"messages"`
	}

	reqBody := openAIRequest{
		Model:       c.model,
		Temperature: 0.1,
		Messages: []openAIMessage{
			{Role: "system", Content: sysPrompt},
			{Role: "user", Content: userPrompt},
		},
	}

	payload, err := json.Marshal(reqBody)
	if err != nil {
		return domain.ExtractTagResponse{}, err
	}

	url := strings.TrimRight(c.baseURL, "/") + "/chat/completions"
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return domain.ExtractTagResponse{}, err
	}
	httpReq.Header.Set("Authorization", "Bearer "+c.apiKey)
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.client.Do(httpReq)
	if err != nil {
		return domain.ExtractTagResponse{}, fmt.Errorf("LLM 接口请求失败: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBytes, _ := io.ReadAll(resp.Body)
		return domain.ExtractTagResponse{}, fmt.Errorf("LLM 返回 HTTP 状态 %d: %s", resp.StatusCode, truncate(string(respBytes), 200))
	}

	var chatResp struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&chatResp); err != nil {
		return domain.ExtractTagResponse{}, fmt.Errorf("解析 LLM 响应失败: %w", err)
	}

	if len(chatResp.Choices) == 0 {
		return domain.ExtractTagResponse{}, fmt.Errorf("LLM 未返回有效回答")
	}

	rawContent := strings.TrimSpace(chatResp.Choices[0].Message.Content)
	if strings.HasPrefix(rawContent, "```json") {
		rawContent = strings.TrimPrefix(rawContent, "```json")
		rawContent = strings.TrimSuffix(rawContent, "```")
	} else if strings.HasPrefix(rawContent, "```") {
		rawContent = strings.TrimPrefix(rawContent, "```")
		rawContent = strings.TrimSuffix(rawContent, "```")
	}
	rawContent = strings.TrimSpace(rawContent)

	var result domain.ExtractTagResponse
	if err := json.Unmarshal([]byte(rawContent), &result); err != nil {
		result.ExtractedTag = rawContent
		result.Reasoning = "大模型事件描述直接归纳提取"
	}

	result.ExtractedTag = strings.TrimSpace(result.ExtractedTag)
	result.Reasoning = strings.TrimSpace(result.Reasoning)
	if result.ExtractedTag == "" {
		return domain.ExtractTagResponse{}, fmt.Errorf("LLM 未能成功抽取有效的标签")
	}

	return result, nil
}
