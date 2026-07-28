package worker

import (
	"testing"

	"github.com/codefun/tagmanager/backend/internal/domain"
	"github.com/codefun/tagmanager/backend/internal/llm"
)

func TestValidateOutput(t *testing.T) {
	entries := []llm.InputEntry{
		{ID: "e1", Name: "cloud", Occurrences: 3},
		{ID: "e2", Name: "cloud-computing", Occurrences: 1},
		{ID: "e3", Name: "data", Occurrences: 2},
	}

	t.Run("empty canonical name rejected", func(t *testing.T) {
		out := domain.ConsolidationOutput{Tags: []domain.ConsolidatedTag{{CanonicalName: "", CoveredIDs: []string{"e1"}}}}
		if err := validateOutput(out, entries); err == nil {
			t.Fatal("expected error for empty canonical name")
		}
	})

	t.Run("unknown covered id rejected", func(t *testing.T) {
		out := domain.ConsolidationOutput{Tags: []domain.ConsolidatedTag{{CanonicalName: "Cloud Computing", CoveredIDs: []string{"e9"}}}}
		if err := validateOutput(out, entries); err == nil {
			t.Fatal("expected error for unknown covered id")
		}
	})

	t.Run("duplicate coverage rejected", func(t *testing.T) {
		out := domain.ConsolidationOutput{Tags: []domain.ConsolidatedTag{
			{CanonicalName: "Cloud Computing", CoveredIDs: []string{"e1"}},
			{CanonicalName: "Cloud", CoveredIDs: []string{"e1"}},
		}}
		if err := validateOutput(out, entries); err == nil {
			t.Fatal("expected error for candidate mapped more than once")
		}
	})

	t.Run("valid output accepted", func(t *testing.T) {
		out := domain.ConsolidationOutput{Tags: []domain.ConsolidatedTag{
			{CanonicalName: "Cloud Computing", CoveredIDs: []string{"e1", "e2"}},
			{CanonicalName: "Data", CoveredIDs: []string{"e3"}},
		}}
		if err := validateOutput(out, entries); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
	})

	t.Run("partial coverage accepted", func(t *testing.T) {
		out := domain.ConsolidationOutput{Tags: []domain.ConsolidatedTag{{CanonicalName: "Cloud Computing", CoveredIDs: []string{"e2"}}}}
		if err := validateOutput(out, entries); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
	})
}

func TestDetermineFailStatus(t *testing.T) {
	tests := []struct {
		name        string
		attempt     int
		maxAttempts int
		want        string
	}{
		{name: "first attempt under max 3", attempt: 1, maxAttempts: 3, want: "retryable_failed"},
		{name: "second attempt under max 3", attempt: 2, maxAttempts: 3, want: "retryable_failed"},
		{name: "third attempt equal max 3", attempt: 3, maxAttempts: 3, want: "failed"},
		{name: "fourth attempt over max 3", attempt: 4, maxAttempts: 3, want: "failed"},
		{name: "single attempt max 1 - first attempt reaches max", attempt: 1, maxAttempts: 1, want: "failed"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := determineFailStatus(tt.attempt, tt.maxAttempts)
			if got != tt.want {
				t.Errorf("determineFailStatus(%d, %d) = %q; want %q", tt.attempt, tt.maxAttempts, got, tt.want)
			}
		})
	}
}

func TestWorkerNewDefaultMaxAttempts(t *testing.T) {
	w := New(nil, nil, nil, 0)
	if w.maxAttempts != 3 {
		t.Errorf("expected default maxAttempts to be 3, got %d", w.maxAttempts)
	}

	wCustom := New(nil, nil, nil, 5)
	if wCustom.maxAttempts != 5 {
		t.Errorf("expected custom maxAttempts to be 5, got %d", wCustom.maxAttempts)
	}
}
