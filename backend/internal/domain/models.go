package domain

import "time"

type Role string

const (
	RoleAdmin    Role = "admin"
	RoleReviewer Role = "reviewer"
	RoleOperator Role = "operator"
)

type User struct {
	ID                 string     `json:"id"`
	Email              string     `json:"email"`
	Role               Role       `json:"role"`
	MustChangePassword bool       `json:"mustChangePassword"`
	PasswordChangedAt  *time.Time `json:"passwordChangedAt,omitempty"`
	CreatedAt          time.Time  `json:"createdAt"`
}

type Namespace struct {
	ID                 string    `json:"id"`
	Name               string    `json:"name"`
	Description        string    `json:"description"`
	CandidateThreshold int       `json:"candidateThreshold"`
	CreatedAt          time.Time `json:"createdAt"`
}

type Tag struct {
	ID             string   `json:"id"`
	NamespaceID    string   `json:"namespaceId"`
	CanonicalName  string   `json:"canonicalName"`
	NormalizedName string   `json:"normalizedName"`
	Description    string   `json:"description"`
	Aliases        []string `json:"aliases"`
	Status         string   `json:"status"`
	Version        int      `json:"version"`
}

type ImportResult struct {
	ID                   string `json:"id"`
	TotalCount           int    `json:"totalCount"`
	MatchedCount         int    `json:"matchedCount"`
	PooledCount          int    `json:"pooledCount"`
	InvalidCount         int    `json:"invalidCount"`
	JobID                string `json:"jobId,omitempty"`
	OpenCandidates       int    `json:"openCandidates,omitempty"`
	Threshold            int    `json:"threshold,omitempty"`
	ConsolidationStatus  string `json:"consolidationStatus,omitempty"`  // created | already_active | reclaimed | not_triggered
	ConsolidationMessage string `json:"consolidationMessage,omitempty"`
}

// ConsolidationTriggerResult is returned by manual (and similar) consolidation triggers.
type ConsolidationTriggerResult struct {
	JobID                string `json:"jobId,omitempty"`
	OpenCandidates       int    `json:"openCandidates"`
	Threshold            int    `json:"threshold"`
	ConsolidationStatus  string `json:"consolidationStatus"` // created | already_active | reclaimed
	ConsolidationMessage string `json:"consolidationMessage"`
}

type PoolEntry struct {
	ID              string    `json:"id"`
	NamespaceID     string    `json:"namespaceId"`
	RawSample       string    `json:"rawSample"`
	NormalizedName  string    `json:"normalizedName"`
	OccurrenceCount int       `json:"occurrenceCount"`
	FirstSeenAt     time.Time `json:"firstSeenAt"`
	LastSeenAt      time.Time `json:"lastSeenAt"`
}

type Proposal struct {
	ID               string        `json:"id"`
	NamespaceID      string        `json:"namespaceId"`
	PoolWindowID     string        `json:"poolWindowId"`
	Status           string        `json:"status"`
	Version          int           `json:"version"`
	ReviewerFeedback string        `json:"reviewerFeedback"`
	CreatedAt        time.Time     `json:"createdAt"`
	Tags             []ProposalTag `json:"tags"`
}

type ProposalTag struct {
	ID              string   `json:"id"`
	CanonicalName   string   `json:"canonicalName"`
	NormalizedName  string   `json:"normalizedName"`
	Description     string   `json:"description"`
	Aliases         []string `json:"aliases"`
	Rationale       string   `json:"rationale"`
	Confidence      float64  `json:"confidence"`
	Accepted        *bool    `json:"accepted"`
	CoveredEntryIDs []string `json:"coveredEntryIds"`
}

type ConsolidationOutput struct {
	Tags []ConsolidatedTag `json:"tags"`
}

type ConsolidatedTag struct {
	CanonicalName string   `json:"canonicalName"`
	Description   string   `json:"description"`
	Aliases       []string `json:"aliases"`
	CoveredIDs    []string `json:"coveredIds"`
	Rationale     string   `json:"rationale"`
	Confidence    float64  `json:"confidence"`
}
