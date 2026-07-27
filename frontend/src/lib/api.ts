import type { ImportResult, Namespace, PoolEntry, Proposal, Tag, User } from '../types/api'

const baseURL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1'

class APIError extends Error { constructor(message: string, public status: number) { super(message) } }

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
  importTags: (payload: { namespaceId: string; sourceName: string; tags: string[]; initialSeed: boolean }) => request<ImportResult>('/imports', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(payload) }),
  proposals: () => request<{ data: Proposal[] }>('/review/proposals'),
  decideProposal: (proposalId: string, payload: { approve: boolean; version: number; comments: string; tags: Array<{ proposalTagId: string; accepted: boolean; canonicalName: string; description: string; aliases: string[] }> }) => request<{ status: string }>(`/review/proposals/${proposalId}/decision`, { method: 'POST', body: JSON.stringify(payload) }),
}

export { APIError }
