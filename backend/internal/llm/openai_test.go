package llm

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/codefun/tagmanager/backend/internal/config"
)

func TestOpenAICompatibleClient_Unconfigured(t *testing.T) {
	tests := []struct {
		name string
		cfg  config.LLMConfig
	}{
		{"missing baseURL", config.LLMConfig{APIKey: "key", Model: "gpt-4o"}},
		{"missing apiKey", config.LLMConfig{BaseURL: "http://localhost", Model: "gpt-4o"}},
		{"missing model", config.LLMConfig{BaseURL: "http://localhost", APIKey: "key"}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client := NewOpenAICompatible(tt.cfg, nil)
			_, err := client.Consolidate(context.Background(), ConsolidationRequest{})
			if err == nil || !strings.Contains(err.Error(), "not configured") {
				t.Fatalf("expected 'not configured' error, got %v", err)
			}
		})
	}
}

func TestOpenAICompatibleClient_Consolidate_SuccessNonStreamFallbackBody(t *testing.T) {
	mockResponseJSON := `{
			"choices": [{
				"message": {
					"content": "{\"tags\":[{\"canonicalName\":\"Cloud Computing\",\"description\":\"Cloud tags\",\"aliases\":[\"cloud\"],\"coveredIds\":[\"e1\"],\"rationale\":\"synonyms\",\"confidence\":0.95}]}"
				}
			}]
		}`

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("expected POST method, got %s", r.Method)
		}
		if r.URL.Path != "/chat/completions" {
			t.Errorf("expected path /chat/completions, got %s", r.URL.Path)
		}
		if auth := r.Header.Get("Authorization"); auth != "Bearer test-api-key" {
			t.Errorf("expected Authorization Bearer test-api-key, got %s", auth)
		}

		bodyBytes, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatalf("failed reading request body: %v", err)
		}
		var reqBody map[string]any
		if err := json.Unmarshal(bodyBytes, &reqBody); err != nil {
			t.Fatalf("request body not JSON: %v", err)
		}
		if reqBody["model"] != "gpt-4o-mini" {
			t.Errorf("expected model gpt-4o-mini, got %v", reqBody["model"])
		}
		if reqBody["temperature"] != float64(0) {
			t.Errorf("expected temperature 0, got %v", reqBody["temperature"])
		}
		if reqBody["stream"] != true {
			t.Errorf("expected stream true, got %v", reqBody["stream"])
		}
		rf, ok := reqBody["response_format"].(map[string]any)
		if !ok || rf["type"] != "json_schema" {
			t.Errorf("expected response_format type json_schema, got %v", reqBody["response_format"])
		}

		// Provider ignores stream and returns normal JSON.
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(mockResponseJSON))
	}))
	defer ts.Close()

	client := NewOpenAICompatible(config.LLMConfig{
		BaseURL: ts.URL,
		APIKey:  "test-api-key",
		Model:   "gpt-4o-mini",
		Timeout: 5 * time.Second,
	}, nil)

	output, err := client.Consolidate(context.Background(), ConsolidationRequest{
		NamespaceName: "default",
		Entries:       []InputEntry{{ID: "e1", Name: "cloud", Occurrences: 1}},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(output.Tags) != 1 {
		t.Fatalf("expected 1 consolidated tag, got %d", len(output.Tags))
	}
	tag := output.Tags[0]
	if tag.CanonicalName != "Cloud Computing" || tag.Confidence != 0.95 {
		t.Errorf("tag mismatch: %+v", tag)
	}
}

func TestOpenAICompatibleClient_Consolidate_StreamSuccess(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		bodyBytes, _ := io.ReadAll(r.Body)
		var reqBody map[string]any
		_ = json.Unmarshal(bodyBytes, &reqBody)
		if reqBody["stream"] != true {
			t.Errorf("expected stream true, got %v", reqBody["stream"])
		}

		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		flusher, _ := w.(http.Flusher)
		chunks := []string{
			`data: {"choices":[{"delta":{"content":"{\"tags\":[{"}}]}` + "\n\n",
			// rewrite as valid incremental JSON pieces
		}
		_ = chunks
		_, _ = io.WriteString(w, "data: {\"choices\":[{\"delta\":{\"content\":\"{\\\"tags\\\":[{\\\"canonicalName\\\":\\\"Cloud\\\"\"}}]}\n\n")
		if flusher != nil {
			flusher.Flush()
		}
		_, _ = io.WriteString(w, "data: {\"choices\":[{\"delta\":{\"content\":\",\\\"description\\\":\\\"c\\\",\\\"aliases\\\":[],\\\"coveredIds\\\":[\\\"e1\\\"],\\\"rationale\\\":\\\"r\\\",\\\"confidence\\\":0.9}]}\"}}]}\n\n")
		if flusher != nil {
			flusher.Flush()
		}
		_, _ = io.WriteString(w, "data: [DONE]\n\n")
		if flusher != nil {
			flusher.Flush()
		}
	}))
	defer ts.Close()

	client := NewOpenAICompatible(config.LLMConfig{
		BaseURL: ts.URL,
		APIKey:  "key",
		Model:   "model",
		Timeout: 5 * time.Second,
	}, nil)

	output, err := client.Consolidate(context.Background(), ConsolidationRequest{
		Entries: []InputEntry{{ID: "e1", Name: "cloud", Occurrences: 1}},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(output.Tags) != 1 || output.Tags[0].CanonicalName != "Cloud" {
		t.Fatalf("unexpected output: %+v", output)
	}
}

func TestOpenAICompatibleClient_Consolidate_HTTPError(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte("internal error from provider"))
	}))
	defer ts.Close()

	client := NewOpenAICompatible(config.LLMConfig{
		BaseURL: ts.URL,
		APIKey:  "key",
		Model:   "model",
	}, nil)

	_, err := client.Consolidate(context.Background(), ConsolidationRequest{})
	if err == nil || !strings.Contains(err.Error(), "500 Internal Server Error") {
		t.Fatalf("expected 500 error status, got %v", err)
	}
}

func TestOpenAICompatibleClient_Consolidate_EmptyChoices(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"choices":[]}`))
	}))
	defer ts.Close()

	client := NewOpenAICompatible(config.LLMConfig{
		BaseURL: ts.URL,
		APIKey:  "key",
		Model:   "model",
	}, nil)

	_, err := client.Consolidate(context.Background(), ConsolidationRequest{})
	if err == nil || !strings.Contains(err.Error(), "no choices") {
		t.Fatalf("expected 'no choices' error, got %v", err)
	}
}

func TestOpenAICompatibleClient_Consolidate_InvalidContentJSON(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"not json"}}]}`))
	}))
	defer ts.Close()

	client := NewOpenAICompatible(config.LLMConfig{
		BaseURL: ts.URL,
		APIKey:  "key",
		Model:   "model",
	}, nil)

	_, err := client.Consolidate(context.Background(), ConsolidationRequest{})
	if err == nil || !strings.Contains(err.Error(), "invalid LLM structured output") {
		t.Fatalf("expected 'invalid LLM structured output' error, got %v", err)
	}
}

func TestOpenAICompatibleClient_Consolidate_WithExistingTags(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		bodyBytes, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatalf("failed reading body: %v", err)
		}
		var reqBody struct {
			Messages []struct {
				Content string `json:"content"`
			} `json:"messages"`
		}
		if err := json.Unmarshal(bodyBytes, &reqBody); err != nil {
			t.Fatalf("failed unmarshaling reqBody: %v", err)
		}
		if len(reqBody.Messages) < 2 {
			t.Fatalf("expected at least 2 messages, got %d", len(reqBody.Messages))
		}
		userContent := reqBody.Messages[1].Content
		if !strings.Contains(userContent, "existingTags") || !strings.Contains(userContent, "交通事故与交通违法") {
			t.Errorf("user content expected to contain existingTags context, got: %s", userContent)
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"{\"tags\":[{\"canonicalName\":\"交通事故与交通违法\",\"description\":\"交通类\",\"aliases\":[\"自行车与机动车碰撞\"],\"coveredIds\":[\"c1\"],\"rationale\":\"r\",\"confidence\":0.95}]}"}}]}`))
	}))
	defer ts.Close()

	client := NewOpenAICompatible(config.LLMConfig{
		BaseURL: ts.URL,
		APIKey:  "key",
		Model:   "model",
	}, nil)

	output, err := client.Consolidate(context.Background(), ConsolidationRequest{
		NamespaceName: "交通",
		ExistingTags: []string{
			"交通事故与交通违法",
		},
		Entries: []InputEntry{
			{ID: "c1", Name: "自行车与机动车碰撞", Occurrences: 1},
		},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(output.Tags) != 1 || output.Tags[0].CanonicalName != "交通事故与交通违法" {
		t.Fatalf("unexpected output: %+v", output)
	}
}
