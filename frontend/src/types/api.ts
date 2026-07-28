export type Role = 'admin' | 'reviewer' | 'operator'

export interface User { id: string; email: string; role: Role; mustChangePassword?: boolean; passwordChangedAt?: string; createdAt?: string }
export interface Namespace { id: string; name: string; description: string; candidateThreshold: number }
export interface Tag { id: string; canonicalName: string; normalizedName: string; description: string; aliases: string[]; status: string; version: number }
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
export interface ProposalTag { id: string; canonicalName: string; description: string; aliases: string[]; rationale: string; confidence: number; coveredEntryIds: string[]; accepted?: boolean }
export interface Proposal { id: string; namespaceId: string; poolWindowId: string; status: string; version: number; reviewerFeedback: string; createdAt: string; tags: ProposalTag[] }
