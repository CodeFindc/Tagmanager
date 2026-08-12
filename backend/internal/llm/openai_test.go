package llm

import (
	"context"
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
	attempts := 0
	mockResponseJSON := `{
		"choices": [{
			"message": {
				"content": "{\"tags\":[{\"canonicalName\":\"Cloud Computing\",\"description\":\"Cloud tags\",\"aliases\":[\"cloud\"],\"coveredIds\":[\"e1\"],\"rationale\":\"synonyms\",\"confidence\":0.95}]}"
			}
		}]
	}`

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts++
		if r.Method != http.MethodPost {
			t.Errorf("expected POST method, got %s", r.Method)
		}
		if r.URL.Path != "/chat/completions" {
			t.Errorf("expected path /chat/completions, got %s", r.URL.Path)
		}
		if auth := r.Header.Get("Authorization"); auth != "Bearer test-api-key" {
			t.Errorf("expected Authorization Bearer test-api-key, got %s", auth)
		}

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
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		flusher, _ := w.(http.Flusher)

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

func TestOpenAICompatibleClient_Consolidate_TTFTTimeoutFallback(t *testing.T) {
	attempts := 0
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts++
		if attempts == 1 {
			// First attempt hangs before TTFT
			w.Header().Set("Content-Type", "text/event-stream")
			w.WriteHeader(http.StatusOK)
			if flusher, ok := w.(http.Flusher); ok {
				flusher.Flush()
			}
			time.Sleep(300 * time.Millisecond)
			return
		}
		// Fallback attempt succeeds immediately
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		flusher, _ := w.(http.Flusher)
		_, _ = io.WriteString(w, "data: {\"choices\":[{\"delta\":{\"content\":\"{\\\"tags\\\":[{\\\"canonicalName\\\":\\\"Fallback\\\",\\\"description\\\":\\\"d\\\",\\\"aliases\\\":[],\\\"coveredIds\\\":[\\\"e1\\\"],\\\"rationale\\\":\\\"r\\\",\\\"confidence\\\":1.0}]}\"}}]}\n\n")
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
		BaseURL:     ts.URL,
		APIKey:      "key",
		Model:       "model",
		Timeout:     5 * time.Second,
		TTFTTimeout: 100 * time.Millisecond,
		IdleTimeout: 100 * time.Millisecond,
	}, nil)

	output, err := client.Consolidate(context.Background(), ConsolidationRequest{
		Entries: []InputEntry{{ID: "e1", Name: "cloud", Occurrences: 1}},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(output.Tags) != 1 || output.Tags[0].CanonicalName != "Fallback" {
		t.Fatalf("unexpected output: %+v", output)
	}
	if attempts < 2 {
		t.Errorf("expected at least 2 attempts due to TTFT fallback, got %d", attempts)
	}
}

func TestOpenAICompatibleClient_Consolidate_IdleTimeoutFallback(t *testing.T) {
	attempts := 0
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts++
		if attempts == 1 {
			// First attempt sends 1 token then pauses > IdleTimeout
			w.Header().Set("Content-Type", "text/event-stream")
			w.WriteHeader(http.StatusOK)
			flusher, _ := w.(http.Flusher)
			_, _ = io.WriteString(w, "data: {\"choices\":[{\"delta\":{\"content\":\"{\\\"tags\\\":\"}}]}\n\n")
			if flusher != nil {
				flusher.Flush()
			}
			time.Sleep(300 * time.Millisecond)
			return
		}
		// Fallback attempt succeeds
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		flusher, _ := w.(http.Flusher)
		_, _ = io.WriteString(w, "data: {\"choices\":[{\"delta\":{\"content\":\"{\\\"tags\\\":[{\\\"canonicalName\\\":\\\"IdleFallback\\\",\\\"description\\\":\\\"d\\\",\\\"aliases\\\":[],\\\"coveredIds\\\":[\\\"e1\\\"],\\\"rationale\\\":\\\"r\\\",\\\"confidence\\\":1.0}]}\"}}]}\n\n")
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
		BaseURL:     ts.URL,
		APIKey:      "key",
		Model:       "model",
		Timeout:     5 * time.Second,
		TTFTTimeout: 100 * time.Millisecond,
		IdleTimeout: 100 * time.Millisecond,
	}, nil)

	output, err := client.Consolidate(context.Background(), ConsolidationRequest{
		Entries: []InputEntry{{ID: "e1", Name: "cloud", Occurrences: 1}},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(output.Tags) != 1 || output.Tags[0].CanonicalName != "IdleFallback" {
		t.Fatalf("unexpected output: %+v", output)
	}
	if attempts < 2 {
		t.Errorf("expected at least 2 attempts due to Idle fallback, got %d", attempts)
	}
}

func TestOpenAICompatibleClient_Consolidate_SlowContinuousStreamSuccess(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		flusher, _ := w.(http.Flusher)

		chunks := []string{
			"data: {\"choices\":[{\"delta\":{\"content\":\"{\\\"tags\\\":[{\\\"canonicalName\\\":\"}}]}\n\n",
			"data: {\"choices\":[{\"delta\":{\"content\":\"\\\"SlowStream\\\",\\\"description\\\":\\\"d\\\",\"}}]}\n\n",
			"data: {\"choices\":[{\"delta\":{\"content\":\"\\\"aliases\\\":[],\\\"coveredIds\\\":[\\\"e1\\\"],\"}}]}\n\n",
			"data: {\"choices\":[{\"delta\":{\"content\":\"\\\"rationale\\\":\\\"r\\\",\\\"confidence\\\":1.0}]}\"}}]}\n\n",
			"data: [DONE]\n\n",
		}

		for _, chunk := range chunks {
			_, _ = io.WriteString(w, chunk)
			if flusher != nil {
				flusher.Flush()
			}
			time.Sleep(30 * time.Millisecond)
		}
	}))
	defer ts.Close()

	// IdleTimeout is 100ms. Chunks arrive every 30ms (< 100ms), total stream time is 150ms (> 100ms).
	client := NewOpenAICompatible(config.LLMConfig{
		BaseURL:     ts.URL,
		APIKey:      "key",
		Model:       "model",
		Timeout:     5 * time.Second,
		TTFTTimeout: 100 * time.Millisecond,
		IdleTimeout: 100 * time.Millisecond,
	}, nil)

	output, err := client.Consolidate(context.Background(), ConsolidationRequest{
		Entries: []InputEntry{{ID: "e1", Name: "cloud", Occurrences: 1}},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(output.Tags) != 1 || output.Tags[0].CanonicalName != "SlowStream" {
		t.Fatalf("unexpected output: %+v", output)
	}
}

func TestOpenAICompatibleClient_Consolidate_ReasoningContent(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		flusher, _ := w.(http.Flusher)

		// First chunk: reasoning_content
		_, _ = io.WriteString(w, "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"thinking process...\"}}]}\n\n")
		if flusher != nil {
			flusher.Flush()
		}
		// Second chunk: content
		_, _ = io.WriteString(w, "data: {\"choices\":[{\"delta\":{\"content\":\"{\\\"tags\\\":[{\\\"canonicalName\\\":\\\"ReasoningTag\\\",\\\"description\\\":\\\"d\\\",\\\"aliases\\\":[],\\\"coveredIds\\\":[\\\"e1\\\"],\\\"rationale\\\":\\\"r\\\",\\\"confidence\\\":1.0}]}\"}}]}\n\n")
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
	if len(output.Tags) != 1 || output.Tags[0].CanonicalName != "ReasoningTag" {
		t.Fatalf("unexpected output: %+v", output)
	}
}

func TestOpenAICompatibleClient_Consolidate_NonStreamLongHeaderSuccess(t *testing.T) {
	// Simulate non-stream server delaying response headers by 300ms (exceeding short header timeouts)
	mockResponseJSON := `{
		"choices": [{
			"message": {
				"content": "{\"tags\":[{\"canonicalName\":\"LongHeaderTag\",\"description\":\"d\",\"aliases\":[],\"coveredIds\":[\"e1\"],\"rationale\":\"r\",\"confidence\":1.0}]}"
			}
		}]
	}`

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(300 * time.Millisecond)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(mockResponseJSON))
	}))
	defer ts.Close()

	client := NewOpenAICompatible(config.LLMConfig{
		BaseURL: ts.URL,
		APIKey:  "key",
		Model:   "model",
		Timeout: 5 * time.Second,
	}, nil)

	// Direct non-stream call should not be killed by a short ResponseHeaderTimeout
	req := client.buildChatCompletionRequest(ConsolidationRequest{
		Entries: []InputEntry{{ID: "e1", Name: "cloud", Occurrences: 1}},
	}, false, false)

	content, err := client.doNonStream(context.Background(), req, 1)
	if err != nil {
		t.Fatalf("unexpected error on non-stream long header delay: %v", err)
	}
	output, err := parseConsolidationContent(content)
	if err != nil {
		t.Fatalf("unexpected parse error: %v", err)
	}
	if len(output.Tags) != 1 || output.Tags[0].CanonicalName != "LongHeaderTag" {
		t.Fatalf("unexpected output: %+v", output)
	}
}
