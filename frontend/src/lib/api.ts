import type { AIAuditConfig, AIAuditEvaluateResponse, APIKey, ConsolidationJob, ConsolidationTriggerResult, CreateAPIKeyResponse, FetchModelsRequest, FetchModelsResponse, ImportResult, Namespace, PoolEntry, Proposal, Role, SystemSettingsPayload, Tag, TagAIAdvice, TagMatchRequest, TagMatchResponse, TestLLMRequest, TestLLMResponse, User } from '../types/api'

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
  let response: Response
  try {
    response = await fetch(`${baseURL}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers },
    })
  } catch (err) {
    throw new APIError(err instanceof Error ? `网络请求失败: ${err.message}` : '网络请求失败', 0)
  }

  let payload: any = {}
  const rawText = await response.text().catch(() => '')
  if (rawText) {
    try {
      payload = JSON.parse(rawText)
    } catch {
      payload = { error: { message: rawText.length > 200 ? rawText.slice(0, 200) + '...' : rawText } }
    }
  }

  if (!response.ok) {
    const msg = payload.error?.message || (response.status === 504 ? '网关响应超时 (504 Gateway Timeout)' : `HTTP 状态 ${response.status}`)
    throw new APIError(msg, response.status)
  }
  return payload as T
}

export const api = {
  login: (email: string, password: string) => request<{ token: string; user: User }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  me: () => request<User>('/me'),
  namespaces: () => request<{ data: Namespace[] }>('/namespaces'),
  createNamespace: (payload: { name: string; description: string; candidateThreshold: number }) => request<Namespace>('/namespaces', { method: 'POST', body: JSON.stringify(payload) }),
  updateNamespace: (id: string, payload: { description: string; candidateThreshold: number }) => request<Namespace>(`/namespaces/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
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
  decideProposal: (proposalId: string, payload: { approve: boolean; action?: 'approve' | 'reject' | 'discard'; version: number; comments: string; tags: Array<{ proposalTagId: string; accepted: boolean; canonicalName: string; description: string; aliases: string[] }> }) => request<{ status: string }>(`/review/proposals/${proposalId}/decision`, { method: 'POST', body: JSON.stringify(payload) }),
  evaluateProposalAI: (proposalId: string, payload: { config?: AIAuditConfig }) => request<AIAuditEvaluateResponse>(`/review/proposals/${proposalId}/ai-evaluate`, { method: 'POST', body: JSON.stringify(payload) }),
  evaluateProposalAIStream: async (
    proposalId: string,
    payload: { config?: AIAuditConfig },
    onChunk?: (chunk: string, type: 'init' | 'ping' | 'chunk') => void
  ): Promise<AIAuditEvaluateResponse> => {
    const token = localStorage.getItem('tagmanager-token')
    const res = await fetch(`${baseURL}/review/proposals/${proposalId}/ai-evaluate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    })

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '')
      throw new APIError(text || `HTTP 状态 ${res.status}`, res.status)
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let finalResult: AIAuditEvaluateResponse | null = null
    let streamErr: string | null = null

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed.startsWith('data:')) {
          const raw = trimmed.slice(5).trim()
          try {
            const parsed = JSON.parse(raw)
            if (parsed.type === 'init') {
              if (onChunk) onChunk('', 'init')
            } else if (parsed.type === 'ping') {
              if (onChunk) onChunk('', 'ping')
            } else if (parsed.type === 'chunk' && parsed.content) {
              if (onChunk) onChunk(parsed.content, 'chunk')
            } else if (parsed.type === 'done' && parsed.result) {
              finalResult = parsed.result
            } else if (parsed.type === 'error' && parsed.error) {
              streamErr = parsed.error
            }
          } catch {}
        }
      }
    }

    if (streamErr) throw new Error(streamErr)
    if (!finalResult) throw new Error('流式读取中断，未获得有效评估 JSON 结果')
    return finalResult
  },
  users: () => request<{ data: User[] }>('/users'),
  createUser: (payload: { email: string; password?: string; role: Role }) => request<{ user: User; initialPassword?: string }>('/users', { method: 'POST', body: JSON.stringify(payload) }),
  updateUserRole: (id: string, role: Role) => request<User>(`/users/${id}/role`, { method: 'PATCH', body: JSON.stringify({ role }) }),
  matchTags: (payload: TagMatchRequest) => request<TagMatchResponse>('/tags/match', { method: 'POST', body: JSON.stringify(payload) }),
  apiKeys: () => request<{ data: APIKey[] }>('/api-keys'),
  createAPIKey: (name: string) => request<CreateAPIKeyResponse>('/api-keys', { method: 'POST', body: JSON.stringify({ name }) }),
  revokeAPIKey: (id: string) => request<{ status: string }>(`/api-keys/${id}/revoke`, { method: 'POST' }),
  deleteAPIKey: (id: string) => request<{ status: string }>(`/api-keys/${id}`, { method: 'DELETE' }),
  changePassword: (payload: { oldPassword: string; newPassword: string }) => request<{ status: string }>('/auth/change-password', { method: 'POST', body: JSON.stringify(payload) }),
  getSettings: () => request<SystemSettingsPayload>('/settings'),
  updateSettings: (payload: SystemSettingsPayload) => request<{ status: string }>('/settings', { method: 'PATCH', body: JSON.stringify(payload) }),
  fetchLLMModels: (payload: FetchModelsRequest) => request<FetchModelsResponse>('/settings/fetch-models', { method: 'POST', body: JSON.stringify(payload) }),
  testLLM: (payload: TestLLMRequest) => request<TestLLMResponse>('/settings/test-llm', { method: 'POST', body: JSON.stringify(payload) }),
}

export { APIError }
