package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/codefun/tagmanager/backend/internal/config"
	"github.com/codefun/tagmanager/backend/internal/domain"
)

type OpenAICompatibleClient struct {
	baseURL, apiKey, model string
	client                 *http.Client
}

func NewOpenAICompatible(cfg config.LLMConfig) *OpenAICompatibleClient {
	return &OpenAICompatibleClient{baseURL: strings.TrimRight(cfg.BaseURL, "/"), apiKey: cfg.APIKey, model: cfg.Model, client: &http.Client{Timeout: cfg.Timeout}}
}

func (c *OpenAICompatibleClient) Consolidate(ctx context.Context, input ConsolidationRequest) (domain.ConsolidationOutput, error) {
	if c.baseURL == "" || c.apiKey == "" || c.model == "" {
		return domain.ConsolidationOutput{}, fmt.Errorf("LLM provider is not configured")
	}
	prompt, err := json.Marshal(input)
	if err != nil {
		return domain.ConsolidationOutput{}, err
	}
	schema := map[string]any{"type": "object", "additionalProperties": false, "properties": map[string]any{"tags": map[string]any{"type": "array", "items": map[string]any{"type": "object", "additionalProperties": false, "properties": map[string]any{"canonicalName": map[string]any{"type": "string"}, "description": map[string]any{"type": "string"}, "aliases": map[string]any{"type": "array", "items": map[string]any{"type": "string"}}, "coveredIds": map[string]any{"type": "array", "items": map[string]any{"type": "string"}}, "rationale": map[string]any{"type": "string"}, "confidence": map[string]any{"type": "number"}}, "required": []string{"canonicalName", "description", "aliases", "coveredIds", "rationale", "confidence"}}}}, "required": []string{"tags"}}
	body := map[string]any{"model": c.model, "temperature": 0, "response_format": map[string]any{"type": "json_schema", "json_schema": map[string]any{"name": "tag_consolidation", "strict": true, "schema": schema}}, "messages": []map[string]string{{"role": "system", "content": "You consolidate raw business tags into a minimal, reviewable taxonomy increment. Never invent coverage IDs. Return only JSON matching the schema."}, {"role": "user", "content": string(prompt)}}}
	encoded, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/chat/completions", bytes.NewReader(encoded))
	if err != nil {
		return domain.ConsolidationOutput{}, err
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	response, err := c.client.Do(req)
	if err != nil {
		return domain.ConsolidationOutput{}, fmt.Errorf("LLM request to %s failed (timeout %s, model %s, %d entries): %w", c.baseURL+"/chat/completions", c.client.Timeout, c.model, len(input.Entries), err)
	}
	defer response.Body.Close()
	payload, _ := io.ReadAll(io.LimitReader(response.Body, 4<<20))
	if response.StatusCode < 200 || response.StatusCode > 299 {
		return domain.ConsolidationOutput{}, fmt.Errorf("LLM returned %s: %s", response.Status, string(payload))
	}
	var decoded struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(payload, &decoded); err != nil {
		return domain.ConsolidationOutput{}, err
	}
	if len(decoded.Choices) == 0 {
		return domain.ConsolidationOutput{}, fmt.Errorf("LLM returned no choices")
	}
	var output domain.ConsolidationOutput
	if err := json.Unmarshal([]byte(decoded.Choices[0].Message.Content), &output); err != nil {
		return domain.ConsolidationOutput{}, fmt.Errorf("invalid LLM structured output: %w", err)
	}
	return output, nil
}
