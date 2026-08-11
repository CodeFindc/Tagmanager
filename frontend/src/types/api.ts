export type Role = 'admin' | 'reviewer' | 'operator'

export interface User { id: string; email: string; role: Role; mustChangePassword?: boolean; passwordChangedAt?: string; createdAt?: string }
export interface Namespace { id: string; name: string; description: string; candidateThreshold: number }
export interface Tag { id: string; namespaceId: string; canonicalName: string; normalizedName: string; description: string; aliases: string[]; status: string; version: number }
export interface PoolEntry { id: string; rawSample: string; normalizedName: string; occurrenceCount: number; firstSeenAt: string; lastSeenAt: string }
export interface ImportResult {
  id: string
  totalCount: number
  matchedCount: number
  pooledCount: number
  invalidCount: number
  jobId?: string
  openCandidates?: number
  threshold?: number
  consolidationStatus?: 'created' | 'already_active' | 'reclaimed' | 'not_triggered' | string
  consolidationMessage?: string
}
export interface ConsolidationTriggerResult {
  jobId?: string
  openCandidates: number
  threshold: number
  consolidationStatus: 'created' | 'already_active' | 'reclaimed' | string
  consolidationMessage: string
}
export interface ConsolidationJob {
  id: string
  namespaceId: string
  jobType: string
  status: string
  attempt: number
  errorMessage: string
  createdAt: string
  startedAt?: string
  completedAt?: string
  runAfter: string
  poolWindowId?: string
  windowStatus?: string
  triggerReason?: string
  threshold?: number
  snapshotCount: number
  proposalId?: string
  proposalStatus?: string
  parentProposalId?: string
}
export interface ProposalTag { id: string; canonicalName: string; description: string; aliases: string[]; rationale: string; confidence: number; coveredEntryIds: string[]; accepted?: boolean; isExistingCanonical?: boolean }
export interface Proposal { id: string; namespaceId: string; poolWindowId: string; status: string; version: number; reviewerFeedback: string; createdAt: string; tags: ProposalTag[] }
export interface TagMatchRequest { namespaceId: string; tag?: string; tags?: string[]; sourceName?: string }
export interface CanonicalTagInfo { id: string; canonicalName: string; description: string; version: number }
export interface TagMatchItemResult { rawTag: string; hit: boolean; matchedAs?: 'canonical' | 'alias' | string; canonicalTag?: CanonicalTagInfo; message?: string }
export interface TagMatchResponse { results: TagMatchItemResult[]; hitCount: number; missCount: number }
export interface APIKey { id: string; userId: string; name: string; keyPrefix: string; status: 'active' | 'revoked' | string; lastUsedAt?: string; createdAt: string }
export interface CreateAPIKeyResponse { apiKey: APIKey; rawKey: string }
export interface AIAuditConfig { baseUrl?: string; apiKey?: string; model?: string; prompt?: string }
export interface TagAIAdvice { canonicalName: string; recommendation: 'accept' | 'edit' | 'reject' | string; reason: string; suggestedName?: string }
export interface AIAuditEvaluateResponse { overallSummary: string; tagAdvice: TagAIAdvice[] }
export interface LLMServiceConfig { baseUrl: string; apiKey: string; model: string; timeoutSeconds?: number; maxRetries?: number; systemPrompt?: string }
export interface SystemSettingsPayload { consolidationLlm: LLMServiceConfig; auditLlm: LLMServiceConfig }
export interface FetchModelsRequest { baseUrl: string; apiKey: string }
export interface FetchModelsResponse { models: string[] }
export interface TestLLMRequest { baseUrl: string; apiKey: string; model: string }
export interface TestLLMResponse { success: boolean; latencyMs: number; message: string }
