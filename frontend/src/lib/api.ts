import type { ConsolidationJob, ConsolidationTriggerResult, ImportResult, Namespace, PoolEntry, Proposal, Role, Tag, User } from '../types/api'

const baseURL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1'

class APIError extends Error { constructor(message: string, public status: number) { super(message) } }

/** Prefer Web Crypto; fall back for non-secure HTTP origins where randomUUID is unavailable. */
function createIdempotencyKey(): string {
  const c = globalThis.crypto as Crypto | undefined
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID()
  }
  if (c && typeof c.getRandomValues === 'function') {
    const bytes = new Uint8Array(16)
    c.getRandomValues(bytes)
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }
  return `idem-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}`.slice(0, 36)
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('tagmanager-token')
  const response = await fetch(`${baseURL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new APIError(payload.error?.message ?? '请求失败', response.status)
  return payload as T
}

export const api = {
  login: (email: string, password: string) => request<{ token: string; user: User }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  me: () => request<User>('/me'),
  namespaces: () => request<{ data: Namespace[] }>('/namespaces'),
  createNamespace: (payload: { name: string; description: string; candidateThreshold: number }) => request<Namespace>('/namespaces', { method: 'POST', body: JSON.stringify(payload) }),
  tags: (namespaceId: string, q = '') => request<{ data: Tag[] }>(`/tags?namespaceId=${encodeURIComponent(namespaceId)}&q=${encodeURIComponent(q)}`),
  pool: (namespaceId: string) => request<{ data: PoolEntry[]; threshold: number }>(`/candidate-pools/${namespaceId}/entries`),
  triggerConsolidation: (namespaceId: string) => request<ConsolidationTriggerResult>(`/candidate-pools/${namespaceId}/consolidate`, { method: 'POST' }),
  consolidationJobs: (namespaceId: string, limit = 50) =>
    request<{ data: ConsolidationJob[] }>(`/consolidation-jobs?namespaceId=${encodeURIComponent(namespaceId)}&limit=${limit}`),
  consolidationJob: (jobId: string) => request<ConsolidationJob>(`/consolidation-jobs/${encodeURIComponent(jobId)}`),
  importTags: (payload: { namespaceId: string; sourceName: string; tags: string[]; initialSeed: boolean }) => request<ImportResult>('/imports', { method: 'POST', headers: { 'Idempotency-Key': createIdempotencyKey() }, body: JSON.stringify(payload) }),
  proposals: (params?: { status?: string }) => {
    const q = params?.status ? `?status=${encodeURIComponent(params.status)}` : ''
    return request<{ data: Proposal[] }>(`/review/proposals${q}`)
  },
  decideProposal: (proposalId: string, payload: { approve: boolean; version: number; comments: string; tags: Array<{ proposalTagId: string; accepted: boolean; canonicalName: string; description: string; aliases: string[] }> }) => request<{ status: string }>(`/review/proposals/${proposalId}/decision`, { method: 'POST', body: JSON.stringify(payload) }),
  users: () => request<{ data: User[] }>('/users'),
  createUser: (payload: { email: string; password?: string; role: Role }) => request<{ user: User; initialPassword?: string }>('/users', { method: 'POST', body: JSON.stringify(payload) }),
  updateUserRole: (id: string, role: Role) => request<User>(`/users/${id}/role`, { method: 'PATCH', body: JSON.stringify({ role }) }),
  changePassword: (payload: { oldPassword: string; newPassword: string }) => request<{ status: string }>('/auth/change-password', { method: 'POST', body: JSON.stringify(payload) }),
}

export { APIError }
