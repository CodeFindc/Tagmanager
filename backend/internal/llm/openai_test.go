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
			client := NewOpenAICompatible(tt.cfg)
			_, err := client.Consolidate(context.Background(), ConsolidationRequest{})
			if err == nil || !strings.Contains(err.Error(), "not configured") {
				t.Fatalf("expected 'not configured' error, got %v", err)
			}
		})
	}
}

func TestOpenAICompatibleClient_Consolidate_Success(t *testing.T) {
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
		if ct := r.Header.Get("Content-Type"); ct != "application/json" {
			t.Errorf("expected Content-Type application/json, got %s", ct)
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
		rf, ok := reqBody["response_format"].(map[string]any)
		if !ok || rf["type"] != "json_schema" {
			t.Errorf("expected response_format type json_schema, got %v", reqBody["response_format"])
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(mockResponseJSON))
	}))
	defer ts.Close()

	client := NewOpenAICompatible(config.LLMConfig{
		BaseURL: ts.URL,
		APIKey:  "test-api-key",
		Model:   "gpt-4o-mini",
		Timeout: 5 * time.Second,
	})

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

func TestOpenAICompatibleClient_Consolidate_HTTPError(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("internal error from provider"))
	}))
	defer ts.Close()

	client := NewOpenAICompatible(config.LLMConfig{
		BaseURL: ts.URL,
		APIKey:  "key",
		Model:   "model",
	})

	_, err := client.Consolidate(context.Background(), ConsolidationRequest{})
	if err == nil || !strings.Contains(err.Error(), "500 Internal Server Error") {
		t.Fatalf("expected 500 error status, got %v", err)
	}
}

func TestOpenAICompatibleClient_Consolidate_EmptyChoices(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"choices":[]}`))
	}))
	defer ts.Close()

	client := NewOpenAICompatible(config.LLMConfig{
		BaseURL: ts.URL,
		APIKey:  "key",
		Model:   "model",
	})

	_, err := client.Consolidate(context.Background(), ConsolidationRequest{})
	if err == nil || !strings.Contains(err.Error(), "no choices") {
		t.Fatalf("expected 'no choices' error, got %v", err)
	}
}

func TestOpenAICompatibleClient_Consolidate_InvalidContentJSON(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"choices":[{"message":{"content":"not json"}}]}`))
	}))
	defer ts.Close()

	client := NewOpenAICompatible(config.LLMConfig{
		BaseURL: ts.URL,
		APIKey:  "key",
		Model:   "model",
	})

	_, err := client.Consolidate(context.Background(), ConsolidationRequest{})
	if err == nil || !strings.Contains(err.Error(), "invalid LLM structured output") {
		t.Fatalf("expected 'invalid LLM structured output' error, got %v", err)
	}
}
