package llm

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/codefun/tagmanager/backend/internal/config"
	"github.com/codefun/tagmanager/backend/internal/domain"
	"github.com/sashabaranov/go-openai"
)

var (
	errTTFTTimeout = errors.New("ttft timeout")
	errIdleTimeout = errors.New("idle timeout")
)

type OpenAICompatibleClient struct {
	baseURL      string
	apiKey       string
	model        string
	client       *openai.Client
	totalTimeout time.Duration
	ttftTimeout  time.Duration
	idleTimeout  time.Duration
	logger       *slog.Logger
}

func NewOpenAICompatible(cfg config.LLMConfig, logger *slog.Logger) *OpenAICompatibleClient {
	if logger == nil {
		logger = slog.Default()
	}
	tot := cfg.Timeout
	if tot <= 0 {
		tot = 1200 * time.Second
	}
	ttft := cfg.TTFTTimeout
	if ttft <= 0 {
		ttft = 150 * time.Second
	}
	if ttft > tot {
		ttft = tot
	}
	idle := cfg.IdleTimeout
	if idle <= 0 {
		idle = 90 * time.Second
	}
	if idle > tot {
		idle = tot
	}

	oc := openai.DefaultConfig(cfg.APIKey)
	oc.BaseURL = strings.TrimRight(cfg.BaseURL, "/")
	oc.HTTPClient = &http.Client{
		Timeout: 0, // No monolithic Client.Timeout; timeouts controlled by ctx + watchdog
		Transport: &http.Transport{
			Proxy:                 http.ProxyFromEnvironment,
			DialContext:           (&net.Dialer{Timeout: 15 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
			TLSHandshakeTimeout:   15 * time.Second,
			ResponseHeaderTimeout: 120 * time.Second,
			IdleConnTimeout:       90 * time.Second,
		},
	}

	return &OpenAICompatibleClient{
		baseURL:      oc.BaseURL,
		apiKey:       cfg.APIKey,
		model:        cfg.Model,
		client:       openai.NewClientWithConfig(oc),
		totalTimeout: tot,
		ttftTimeout:  ttft,
		idleTimeout:  idle,
		logger:       logger,
	}
}

func (c *OpenAICompatibleClient) clientFor(baseURL, apiKey string, timeout time.Duration) *openai.Client {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		baseURL = c.baseURL
	}
	apiKey = strings.TrimSpace(apiKey)
	if apiKey == "" {
		apiKey = c.apiKey
	}
	oc := openai.DefaultConfig(apiKey)
	oc.BaseURL = baseURL
	oc.HTTPClient = &http.Client{
		Timeout: timeout,
		Transport: &http.Transport{
			Proxy:                 http.ProxyFromEnvironment,
			DialContext:           (&net.Dialer{Timeout: 15 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
			TLSHandshakeTimeout:   15 * time.Second,
			ResponseHeaderTimeout: 120 * time.Second,
			IdleConnTimeout:       90 * time.Second,
		},
	}
	return openai.NewClientWithConfig(oc)
}

func (c *OpenAICompatibleClient) Consolidate(ctx context.Context, input ConsolidationRequest) (domain.ConsolidationOutput, error) {
	if c.baseURL == "" || c.apiKey == "" || c.model == "" {
		return domain.ConsolidationOutput{}, fmt.Errorf("LLM provider is not configured")
	}

	started := time.Now()
	c.logger.Info("llm request starting",
		"baseUrl", c.baseURL,
		"model", c.model,
		"entries", len(input.Entries),
		"totalTimeout", c.totalTimeout.String(),
		"ttftTimeout", c.ttftTimeout.String(),
		"idleTimeout", c.idleTimeout.String(),
		"stream", true,
	)

	attemptCtx, cancel := context.WithTimeout(ctx, c.totalTimeout)
	defer cancel()

	req := c.buildChatCompletionRequest(input, true, true)
	content, err := c.doStream(attemptCtx, req, len(input.Entries))
	if err != nil {
		if isStreamOrSchemaUnsupported(err) {
			c.logger.Warn("llm streaming with strict json_schema failed/timed out, falling back without strict json_schema", "error", err)
			reqNoSchema := c.buildChatCompletionRequest(input, true, false)
			content, err = c.doStream(attemptCtx, reqNoSchema, len(input.Entries))
			if err != nil {
				c.logger.Warn("llm streaming fallback failed, falling back to non-stream", "error", err)
				reqNonStream := c.buildChatCompletionRequest(input, false, false)
				content, err = c.doNonStream(attemptCtx, reqNonStream, len(input.Entries))
			}
		}
		if err != nil {
			return domain.ConsolidationOutput{}, fmt.Errorf("LLM request to %s failed (timeout %s, model %s, %d entries, elapsed %s): %w",
				c.baseURL, c.totalTimeout, c.model, len(input.Entries), time.Since(started).Round(time.Millisecond), err)
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

func (c *OpenAICompatibleClient) buildChatCompletionRequest(input ConsolidationRequest, stream bool, useSchema bool) openai.ChatCompletionRequest {
	promptBytes, _ := json.Marshal(input)
	sysPrompt := "You consolidate raw business tags into a minimal, reviewable taxonomy increment. You are provided with `existingTags` (already published canonical tag names in this namespace) and `entries` (unresolved raw candidate tags, each having an `id`, `name`, and `occurrences`). CRITICAL: In `coveredIds`, you MUST list the exact `id` strings of all candidate entries in `entries` that are covered or mapped by this proposed tag. Do NOT leave `coveredIds` empty. Every entry `id` from `entries` must appear in exactly one tag's `coveredIds` array. Never invent fake IDs. Prefer mapping candidate entries to existing published tags in `existingTags` as new aliases, or reusing an existing canonicalName, rather than creating redundant new canonical tags whenever an existing tag matches the semantic intent. In `aliases`, include ONLY newly proposed alias names for this batch—do NOT include existing canonical tag names or previously published aliases. Return ONLY valid JSON matching structure: {\"tags\":[{\"canonicalName\":string,\"description\":string,\"aliases\":[string],\"coveredIds\":[string],\"rationale\":string,\"confidence\":number}]}."

	req := openai.ChatCompletionRequest{
		Model:       c.model,
		Temperature: 0,
		Stream:      stream,
		Messages: []openai.ChatCompletionMessage{
			{Role: openai.ChatMessageRoleSystem, Content: sysPrompt},
			{Role: openai.ChatMessageRoleUser, Content: string(promptBytes)},
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
		schemaBytes, _ := json.Marshal(schema)
		req.ResponseFormat = &openai.ChatCompletionResponseFormat{
			Type: openai.ChatCompletionResponseFormatTypeJSONSchema,
			JSONSchema: &openai.ChatCompletionResponseFormatJSONSchema{
				Name:   "tag_consolidation",
				Strict: true,
				Schema: json.RawMessage(schemaBytes),
			},
		}
	}
	return req
}

func (c *OpenAICompatibleClient) doStream(ctx context.Context, req openai.ChatCompletionRequest, entryCount int) (string, error) {
	reqCtx, cancel := context.WithCancelCause(ctx)
	defer cancel(nil)

	var timer *time.Timer
	armed := false

	timer = time.AfterFunc(c.ttftTimeout, func() {
		cancel(errTTFTTimeout)
	})
	defer func() {
		if timer != nil {
			timer.Stop()
		}
	}()

	stream, err := c.client.CreateChatCompletionStream(reqCtx, req)
	if err != nil {
		return "", classifyError(err, context.Cause(reqCtx), c.ttftTimeout, c.idleTimeout, false)
	}
	defer stream.Close()

	var content strings.Builder
	var reasoningContent strings.Builder
	chunks := 0
	started := time.Now()
	lastLogAt := time.Now()

	for {
		resp, err := stream.Recv()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return "", classifyError(err, context.Cause(reqCtx), c.ttftTimeout, c.idleTimeout, content.Len() > 0 || reasoningContent.Len() > 0)
		}

		if len(resp.Choices) == 0 {
			continue
		}
		delta := resp.Choices[0].Delta
		text := delta.Content
		isReasoning := false
		if text == "" {
			reasoningText := extractReasoningContent(resp)
			if reasoningText != "" {
				text = reasoningText
				isReasoning = true
			}
		}
		if text == "" {
			continue
		}

		if !armed {
			armed = true
			c.logger.Info("llm first token received",
				"ttft", time.Since(started).Round(time.Millisecond).String(),
				"isReasoning", isReasoning,
			)
		}
		timer.Reset(c.idleTimeout)

		if isReasoning {
			reasoningContent.WriteString(text)
		} else {
			content.WriteString(text)
		}
		chunks++

		c.logger.Debug("llm token chunk", "chunk", chunks, "isReasoning", isReasoning, "text", text)

		if time.Since(lastLogAt) >= 3*time.Second {
			if content.Len() > 0 {
				c.logger.Info("llm stream progress summary",
					"chunks", chunks,
					"contentBytes", content.Len(),
					"elapsed", time.Since(started).Round(time.Millisecond).String(),
					"preview", truncate(content.String(), 120),
				)
			} else if reasoningContent.Len() > 0 {
				c.logger.Info("llm reasoning progress summary",
					"chunks", chunks,
					"reasoningBytes", reasoningContent.Len(),
					"elapsed", time.Since(started).Round(time.Millisecond).String(),
					"preview", truncate(reasoningContent.String(), 120),
				)
			}
			lastLogAt = time.Now()
		}
	}

	if content.Len() == 0 {
		if reasoningContent.Len() > 0 {
			return "", fmt.Errorf("LLM 输出了思考过程但未输出最终 content (%d chunks)", chunks)
		}
		return "", fmt.Errorf("LLM stream completed with empty content (%d chunks)", chunks)
	}
	return content.String(), nil
}

type reasoningChunk struct {
	Choices []struct {
		Delta struct {
			ReasoningContent string `json:"reasoning_content"`
		} `json:"delta"`
	} `json:"choices"`
}

func extractReasoningContent(resp openai.ChatCompletionStreamResponse) string {
	b, err := json.Marshal(resp)
	if err != nil {
		return ""
	}
	var rc reasoningChunk
	if err := json.Unmarshal(b, &rc); err == nil && len(rc.Choices) > 0 {
		return rc.Choices[0].Delta.ReasoningContent
	}
	return ""
}

func (c *OpenAICompatibleClient) doNonStream(ctx context.Context, req openai.ChatCompletionRequest, entryCount int) (string, error) {
	resp, err := c.client.CreateChatCompletion(ctx, req)
	if err != nil {
		return "", err
	}
	if len(resp.Choices) == 0 {
		return "", fmt.Errorf("LLM returned empty choices")
	}
	return resp.Choices[0].Message.Content, nil
}

func classifyError(err error, cause error, ttft, idle time.Duration, gotContent bool) error {
	if err == nil {
		return nil
	}
	if errors.Is(cause, errTTFTTimeout) || (cause != nil && strings.Contains(cause.Error(), "ttft timeout")) {
		return fmt.Errorf("大模型生成流响应超时 (wait first token timeout: TTFT > %v)。提示：大模型 Prefill 预处理暂无响应或卡死，系统已自动切断并触发 Fallback 降级", ttft)
	}
	if errors.Is(cause, errIdleTimeout) || (cause != nil && strings.Contains(cause.Error(), "idle timeout")) {
		return fmt.Errorf("大模型生成流响应空闲超时 (inter-token idle timeout > %v)。提示：大模型中途停顿未产生新 Token，系统已自动切断并触发 Fallback 降级", idle)
	}
	if errors.Is(err, context.DeadlineExceeded) || strings.Contains(err.Error(), "context deadline exceeded") {
		if gotContent {
			return fmt.Errorf("大模型生成流响应空闲超时 (inter-token idle timeout > %v): %w", idle, err)
		}
		return fmt.Errorf("大模型首 Token 响应超时 (wait first token timeout: TTFT > %v): %w", ttft, err)
	}
	return err
}

func isStreamOrSchemaUnsupported(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, errTTFTTimeout) || errors.Is(err, errIdleTimeout) {
		return true
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "stream") ||
		strings.Contains(msg, "json_schema") ||
		strings.Contains(msg, "response_format") ||
		strings.Contains(msg, "guided_decoding") ||
		strings.Contains(msg, "grammar") ||
		strings.Contains(msg, "ttft") ||
		strings.Contains(msg, "idle") ||
		strings.Contains(msg, "wait first token timeout") ||
		strings.Contains(msg, "400") ||
		strings.Contains(msg, "unsupported") ||
		strings.Contains(msg, "not support") ||
		strings.Contains(msg, "invalid")
}

func parseConsolidationContent(content string) (domain.ConsolidationOutput, error) {
	cleaned := strings.TrimSpace(content)
	if strings.HasPrefix(cleaned, "```json") {
		cleaned = strings.TrimPrefix(cleaned, "```json")
		cleaned = strings.TrimSuffix(cleaned, "```")
	} else if strings.HasPrefix(cleaned, "```") {
		cleaned = strings.TrimPrefix(cleaned, "```")
		cleaned = strings.TrimSuffix(cleaned, "```")
	}
	cleaned = strings.TrimSpace(cleaned)

	var output domain.ConsolidationOutput
	if err := json.Unmarshal([]byte(cleaned), &output); err != nil {
		return domain.ConsolidationOutput{}, fmt.Errorf("invalid LLM structured output: %w; preview=%q", err, truncate(cleaned, 240))
	}
	return output, nil
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

	schemaBytes, _ := json.Marshal(schema)
	req := openai.ChatCompletionRequest{
		Model:       model,
		Temperature: 0.2,
		MaxTokens:   8192,
		Messages: []openai.ChatCompletionMessage{
			{Role: openai.ChatMessageRoleSystem, Content: sysPrompt},
			{Role: openai.ChatMessageRoleUser, Content: string(userPayload)},
		},
		ResponseFormat: &openai.ChatCompletionResponseFormat{
			Type: openai.ChatCompletionResponseFormatTypeJSONSchema,
			JSONSchema: &openai.ChatCompletionResponseFormatJSONSchema{
				Name:   "ai_audit_response",
				Strict: true,
				Schema: json.RawMessage(schemaBytes),
			},
		},
	}

	timeout := 600 * time.Second
	if cfg.TimeoutSeconds > 0 {
		tSec := cfg.TimeoutSeconds
		if tSec < 300 {
			tSec = 300
		}
		timeout = time.Duration(tSec) * time.Second
	}

	client := c.clientFor(baseURL, apiKey, timeout)
	resp, err := client.CreateChatCompletion(ctx, req)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) || strings.Contains(err.Error(), "context deadline exceeded") || strings.Contains(err.Error(), "Client.Timeout") {
			return domain.AIAuditEvaluateResponse{}, fmt.Errorf("AI 助审大模型响应超时 (超过 %d 秒未返回)。提示：模型对较多提案标签评估生成耗时较长，请前往【设置中心】增大超时时间(TimeoutSeconds，建议 600 秒以上)", int(timeout.Seconds()))
		}
		return domain.AIAuditEvaluateResponse{}, fmt.Errorf("请求 AI 助审 Endpoint (%s) 失败: %w", baseURL, err)
	}

	if len(resp.Choices) == 0 {
		return domain.AIAuditEvaluateResponse{}, fmt.Errorf("AI 助审服务未返回有效 Choices")
	}

	var result domain.AIAuditEvaluateResponse
	rawContent := strings.TrimSpace(resp.Choices[0].Message.Content)
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

	schemaBytes, _ := json.Marshal(schema)
	req := openai.ChatCompletionRequest{
		Model:       model,
		Stream:      true,
		Temperature: 0.2,
		MaxTokens:   8192,
		Messages: []openai.ChatCompletionMessage{
			{Role: openai.ChatMessageRoleSystem, Content: sysPrompt},
			{Role: openai.ChatMessageRoleUser, Content: string(userPayload)},
		},
		ResponseFormat: &openai.ChatCompletionResponseFormat{
			Type: openai.ChatCompletionResponseFormatTypeJSONSchema,
			JSONSchema: &openai.ChatCompletionResponseFormatJSONSchema{
				Name:   "ai_audit_response",
				Strict: true,
				Schema: json.RawMessage(schemaBytes),
			},
		},
	}

	tot := 300 * time.Second
	if cfg.TimeoutSeconds > 0 {
		tot = time.Duration(cfg.TimeoutSeconds) * time.Second
	}
	ttft := 150 * time.Second
	if ttft > tot {
		ttft = tot
	}
	idle := 90 * time.Second
	if idle > tot {
		idle = tot
	}

	client := c.clientFor(baseURL, apiKey, 0)
	reqCtx, cancel := context.WithCancelCause(ctx)
	defer cancel(nil)

	timer := time.AfterFunc(ttft, func() {
		cancel(errTTFTTimeout)
	})
	defer timer.Stop()

	stream, err := client.CreateChatCompletionStream(reqCtx, req)
	if err != nil {
		return c.EvaluateProposal(ctx, cfg, proposal, candidateEntries)
	}
	defer stream.Close()

	var fullContent strings.Builder
	for {
		resp, err := stream.Recv()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			if fullContent.Len() == 0 {
				return c.EvaluateProposal(ctx, cfg, proposal, candidateEntries)
			}
			return domain.AIAuditEvaluateResponse{}, classifyError(err, context.Cause(reqCtx), ttft, idle, true)
		}
		if len(resp.Choices) == 0 {
			continue
		}
		text := resp.Choices[0].Delta.Content
		if text == "" {
			continue
		}
		timer.Reset(idle)
		fullContent.WriteString(text)
		if onChunk != nil {
			onChunk(text)
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

	client := c.clientFor(baseURL, apiKey, 15*time.Second)
	res, err := client.ListModels(ctx)
	if err != nil {
		return nil, fmt.Errorf("无法连接到 %s/models: %w", baseURL, err)
	}

	models := make([]string, 0, len(res.Models))
	for _, m := range res.Models {
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

	client := c.clientFor(baseURL, apiKey, 15*time.Second)
	req := openai.ChatCompletionRequest{
		Model: model,
		Messages: []openai.ChatCompletionMessage{
			{Role: openai.ChatMessageRoleUser, Content: "ping"},
		},
		MaxTokens: 1,
	}

	started := time.Now()
	_, err := client.CreateChatCompletion(ctx, req)
	latency := time.Since(started).Milliseconds()
	if err != nil {
		return latency, fmt.Errorf("连接失败: %w", err)
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

	chatReq := openai.ChatCompletionRequest{
		Model:       c.model,
		Temperature: 0.1,
		Messages: []openai.ChatCompletionMessage{
			{Role: openai.ChatMessageRoleSystem, Content: sysPrompt},
			{Role: openai.ChatMessageRoleUser, Content: userPrompt},
		},
	}

	resp, err := c.client.CreateChatCompletion(ctx, chatReq)
	if err != nil {
		return domain.ExtractTagResponse{}, fmt.Errorf("LLM 接口请求失败: %w", err)
	}

	if len(resp.Choices) == 0 {
		return domain.ExtractTagResponse{}, fmt.Errorf("LLM 未返回有效回答")
	}

	rawContent := strings.TrimSpace(resp.Choices[0].Message.Content)
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
