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

// ConsolidationJobView is a read model joining job + window + optional proposal.
type ConsolidationJobView struct {
	ID               string     `json:"id"`
	NamespaceID      string     `json:"namespaceId"`
	JobType          string     `json:"jobType"`
	Status           string     `json:"status"`
	Attempt          int        `json:"attempt"`
	ErrorMessage     string     `json:"errorMessage"`
	CreatedAt        time.Time  `json:"createdAt"`
	StartedAt        *time.Time `json:"startedAt,omitempty"`
	CompletedAt      *time.Time `json:"completedAt,omitempty"`
	RunAfter         time.Time  `json:"runAfter"`
	PoolWindowID     string     `json:"poolWindowId,omitempty"`
	WindowStatus     string     `json:"windowStatus,omitempty"`
	TriggerReason    string     `json:"triggerReason,omitempty"`
	Threshold        int        `json:"threshold,omitempty"`
	SnapshotCount    int        `json:"snapshotCount"`
	ProposalID       *string    `json:"proposalId,omitempty"`
	ProposalStatus   *string    `json:"proposalStatus,omitempty"`
	ParentProposalID *string    `json:"parentProposalId,omitempty"`
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
	ID                  string   `json:"id"`
	CanonicalName       string   `json:"canonicalName"`
	NormalizedName      string   `json:"normalizedName"`
	Description         string   `json:"description"`
	Aliases             []string `json:"aliases"`
	Rationale           string   `json:"rationale"`
	Confidence          float64  `json:"confidence"`
	Accepted            *bool    `json:"accepted"`
	CoveredEntryIDs     []string `json:"coveredEntryIds"`
	IsExistingCanonical bool     `json:"isExistingCanonical"`
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

type TagMatchRequest struct {
	NamespaceID string   `json:"namespaceId"`
	Tag         string   `json:"tag,omitempty"`
	Tags        []string `json:"tags,omitempty"`
	SourceName  string   `json:"sourceName,omitempty"`
}

type CanonicalTagInfo struct {
	ID            string `json:"id"`
	CanonicalName string `json:"canonicalName"`
	Description   string `json:"description"`
	Version       int    `json:"version"`
}

type TagMatchItemResult struct {
	RawTag       string            `json:"rawTag"`
	Hit          bool              `json:"hit"`
	MatchedAs    string            `json:"matchedAs,omitempty"` // "canonical" | "alias"
	CanonicalTag *CanonicalTagInfo `json:"canonicalTag,omitempty"`
	Message      string            `json:"message,omitempty"`
}

type TagMatchResponse struct {
	Results   []TagMatchItemResult `json:"results"`
	HitCount  int                  `json:"hitCount"`
	MissCount int                  `json:"missCount"`
}

type APIKey struct {
	ID         string     `json:"id"`
	UserID     string     `json:"userId"`
	Name       string     `json:"name"`
	KeyPrefix  string     `json:"keyPrefix"`
	Status     string     `json:"status"`
	LastUsedAt *time.Time `json:"lastUsedAt,omitempty"`
	CreatedAt  time.Time  `json:"createdAt"`
}

type CreateAPIKeyResponse struct {
	APIKey APIKey `json:"apiKey"`
	RawKey string `json:"rawKey"`
}

type AIAuditConfig struct {
	BaseURL        string `json:"baseUrl,omitempty"`
	APIKey         string `json:"apiKey,omitempty"`
	Model          string `json:"model,omitempty"`
	TimeoutSeconds int    `json:"timeoutSeconds,omitempty"`
	MaxRetries     int    `json:"maxRetries,omitempty"`
	Prompt         string `json:"prompt,omitempty"`
}

type AIAuditEvaluateRequest struct {
	Config AIAuditConfig `json:"config,omitempty"`
}

type TagAIAdvice struct {
	CanonicalName  string `json:"canonicalName"`
	Recommendation string `json:"recommendation"` // "accept" | "edit" | "reject"
	Reason         string `json:"reason"`
	SuggestedName  string `json:"suggestedName,omitempty"`
}

type AIAuditEvaluateResponse struct {
	OverallSummary string        `json:"overallSummary"`
	TagAdvice      []TagAIAdvice `json:"tagAdvice"`
}

type LLMServiceConfig struct {
	BaseURL        string `json:"baseUrl"`
	APIKey         string `json:"apiKey"`
	Model          string `json:"model"`
	TimeoutSeconds int    `json:"timeoutSeconds,omitempty"`
	MaxRetries     int    `json:"maxRetries,omitempty"`
	SystemPrompt   string `json:"systemPrompt,omitempty"`
}

type SystemSettingsPayload struct {
	ConsolidationLLM LLMServiceConfig `json:"consolidationLlm"`
	AuditLLM         LLMServiceConfig `json:"auditLlm"`
}

type FetchModelsRequest struct {
	BaseURL string `json:"baseUrl"`
	APIKey  string `json:"apiKey"`
}

type FetchModelsResponse struct {
	Models []string `json:"models"`
}

type TestLLMRequest struct {
	BaseURL string `json:"baseUrl"`
	APIKey  string `json:"apiKey"`
	Model   string `json:"model"`
}

type TestLLMResponse struct {
	Success   bool   `json:"success"`
	LatencyMs int64  `json:"latencyMs"`
	Message   string `json:"message"`
}
