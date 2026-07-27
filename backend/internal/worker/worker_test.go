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
