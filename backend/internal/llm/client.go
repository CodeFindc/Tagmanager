package llm

import (
	"context"
	"github.com/codefun/tagmanager/backend/internal/domain"
)

type ConsolidationRequest struct {
	NamespaceName string
	Feedback      string
	Entries       []InputEntry
}

type InputEntry struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Occurrences int    `json:"occurrences"`
}

type Client interface {
	Consolidate(context.Context, ConsolidationRequest) (domain.ConsolidationOutput, error)
}
