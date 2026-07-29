package llm

import (
	"context"
	"github.com/codefun/tagmanager/backend/internal/domain"
)

type ExistingTag struct {
	CanonicalName string   `json:"canonicalName"`
	Aliases       []string `json:"aliases,omitempty"`
}

type ConsolidationRequest struct {
	NamespaceName string        `json:"namespaceName"`
	Feedback      string        `json:"feedback,omitempty"`
	ExistingTags  []ExistingTag `json:"existingTags,omitempty"`
	Entries       []InputEntry  `json:"entries"`
}

type InputEntry struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Occurrences int    `json:"occurrences"`
}

type Client interface {
	Consolidate(context.Context, ConsolidationRequest) (domain.ConsolidationOutput, error)
}
