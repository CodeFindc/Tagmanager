import { Component, ErrorInfo, FormEvent, ReactNode, useEffect, useMemo, useState } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { api } from './lib/api'
import type { AIAuditConfig, AIAuditEvaluateResponse, APIKey, ConsolidationJob, ImportResult, Namespace, PoolEntry, Proposal, ProposalTag, Role, Tag, TagAIAdvice, TagMatchItemResult, TagMatchResponse, User } from './types/api'
import {
  EmptyState,
  Field,
  Modal,
  Notice,
  PageHeader,
  Panel,
  StatCard,
  StatusBadge,
  SuccessNotice,
  TableShell,
  Toolbar,
  btnDanger,
  btnPrimary,
  btnSecondary,
  btnSuccess,
  btnWarning,
  inputClass,
} from './components/ui'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false,
    error: null,
  }

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Unhandled UI error:', error, errorInfo)
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 max-w-xl mx-auto my-8">
          <Notice message={`页面渲染发生错误: ${this.state.error?.message || '未知错误'}`} />
          <button
            type="button"
            onClick={() => {
              this.setState({ hasError: false, error: null })
              window.location.reload()
            }}
            className="mt-4 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand/90"
          >
            刷新页面
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

export function App() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [showPasswordModal, setShowPasswordModal] = useState(false)

  useEffect(() => {
    if (!localStorage.getItem('tagmanager-token')) {
      setLoading(false)
      return
    }
    api.me().then(setUser).catch(() => localStorage.removeItem('tagmanager-token')).finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="grid min-h-screen place-items-center text-slate-500">正在载入控制台…</div>
  if (!user) return <Login onLogin={setUser} />

  const menu = [
    ['/', '概览'],
    ['/tags', '标签库'],
    ['/imports', '批次导入'],
    ['/pool', '候选池'],
    ['/review', '审核中心'],
    ['/api-docs', 'API 开放接入'],
    ...(user.role === 'admin' ? [['/namespaces', '标签域'], ['/users', '用户管理']] : []),
  ] as const

  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-5 sm:py-4">
          <div className="min-w-0">
            <p className="text-lg font-bold text-ink">Tag Manager</p>
            <p className="text-xs text-slate-500">LLM 辅助的可审核标签库</p>
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:gap-4 text-sm">
            <div className="hidden text-right sm:block">
              <p className="font-medium">
                {user.email}{' '}
                <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-600">{user.role}</span>
              </p>
            </div>
            <button className="rounded border px-2 py-1 text-xs text-slate-600 hover:text-slate-900" onClick={() => setShowPasswordModal(true)}>
              修改密码
            </button>
            <button
              className="text-sm font-medium text-brand"
              onClick={() => {
                localStorage.removeItem('tagmanager-token')
                setUser(null)
              }}
            >
              退出
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-5 sm:px-5 sm:py-6 md:grid-cols-[168px_minmax(0,1fr)]">
        <nav className="flex gap-2 overflow-x-auto md:flex-col md:overflow-visible">
          {menu.map(([to, label]) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${isActive ? 'bg-brand text-white' : 'text-slate-600 hover:bg-white'}`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>

        <main className="min-w-0">
          <Routes>
            <Route path="/" element={<Dashboard isAdmin={user.role === 'admin'} />} />
            <Route path="/tags" element={<TagsPage />} />
            <Route path="/imports" element={<ImportPage />} />
            <Route path="/pool" element={<PoolPage canTrigger={user.role === 'admin'} />} />
            <Route path="/review" element={<ReviewPage />} />
            <Route path="/api-docs" element={<ApiDocsPage />} />
            {user.role === 'admin' && <Route path="/namespaces" element={<NamespacesPage />} />}
            {user.role === 'admin' && <Route path="/users" element={<UsersPage />} />}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>

      {showPasswordModal && <ChangePasswordModal onClose={() => setShowPasswordModal(false)} />}
    </div>
  )
}

function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [email, setEmail] = useState('admin@example.com')
  const [password, setPassword] = useState('change-me-now')
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    try {
      const result = await api.login(email, password)
      localStorage.setItem('tagmanager-token', result.token)
      onLogin(result.user)
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败')
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-slate-950 p-5">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl bg-white p-7 shadow-2xl">
        <h1 className="text-2xl font-bold">标签管理库</h1>
        <p className="mt-2 text-sm text-slate-500">使用账号进入控制台。</p>
        <label className="mt-6 block text-sm font-medium">
          邮箱
          <input className={`mt-1 ${inputClass}`} value={email} onChange={e => setEmail(e.target.value)} />
        </label>
        <label className="mt-4 block text-sm font-medium">
          密码
          <input type="password" className={`mt-1 ${inputClass}`} value={password} onChange={e => setPassword(e.target.value)} />
        </label>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <button className={`mt-6 w-full ${btnPrimary}`}>登录</button>
      </form>
    </div>
  )
}

function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setSuccess('')
    try {
      await api.changePassword({ oldPassword, newPassword })
      setSuccess('密码修改成功！')
      setTimeout(onClose, 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : '密码修改失败')
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="text-xl font-bold">修改当前账号密码</h2>
        <form onSubmit={submit} className="mt-4 space-y-4">
          <Field label="原密码">
            <input type="password" required className={inputClass} value={oldPassword} onChange={e => setOldPassword(e.target.value)} />
          </Field>
          <Field label="新密码">
            <p className="mb-1 text-xs text-slate-500">至少12位，需包含大小写字母、数字和符号</p>
            <input type="password" required className={inputClass} value={newPassword} onChange={e => setNewPassword(e.target.value)} />
          </Field>
          {error && <Notice message={error} />}
          {success && <SuccessNotice message={success} />}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className={btnSecondary}>取消</button>
            <button type="submit" className={btnPrimary}>确认修改</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function NamespacesPage() {
  const [items, setItems] = useState<Namespace[]>([])
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [candidateThreshold, setCandidateThreshold] = useState(50)
  const [submitting, setSubmitting] = useState(false)

  const reload = () => {
    api.namespaces()
      .then(res => setItems(res.data))
      .catch(err => setError(err instanceof Error ? err.message : '加载标签域失败'))
  }
  useEffect(() => { reload() }, [])

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setError('标签域名称不能为空')
      return
    }
    if (!Number.isInteger(candidateThreshold) || candidateThreshold < 1) {
      setError('候选池阈值必须是大于 0 的整数')
      return
    }
    setError('')
    setSuccess('')
    setSubmitting(true)
    try {
      const created = await api.createNamespace({
        name: trimmed,
        description: description.trim(),
        candidateThreshold,
      })
      setName('')
      setDescription('')
      setCandidateThreshold(50)
      setSuccess(`已创建标签域「${created.name}」，候选池阈值 ${created.candidateThreshold}。可前往批次导入首批标签。`)
      reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建标签域失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="space-y-5">
      <PageHeader
        title="标签域管理"
        description="按业务隔离标签库与候选池；阈值决定未命中标签累计多少后冻结窗口并触发模型归并。"
      />

      {error && <Notice message={error} />}
      {success && <SuccessNotice message={success} />}

      <Panel title="创建标签域" description="默认阈值 50；设为较小值（如 5）便于联调。创建后暂不支持在界面修改阈值。">
        <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-3">
          <Field label="名称" className="min-w-[160px] flex-1">
            <input required placeholder="例如：产品能力 / 行业主题" className={inputClass} value={name} onChange={e => setName(e.target.value)} />
          </Field>
          <Field label="描述（可选）" className="min-w-[200px] flex-[2]">
            <input placeholder="用途说明" className={inputClass} value={description} onChange={e => setDescription(e.target.value)} />
          </Field>
          <Field label="候选池阈值" className="w-32">
            <input required type="number" min={1} step={1} className={inputClass} value={candidateThreshold} onChange={e => setCandidateThreshold(Number(e.target.value))} />
          </Field>
          <button type="submit" disabled={submitting} className={btnPrimary}>
            {submitting ? '创建中…' : '创建标签域'}
          </button>
        </form>
      </Panel>

      <TableShell>
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="p-3 font-medium">名称</th>
              <th className="p-3 font-medium">描述</th>
              <th className="p-3 font-medium">阈值</th>
              <th className="hidden p-3 font-medium lg:table-cell">ID</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr className="border-t">
                <td colSpan={4} className="p-6 text-center text-slate-500">暂无标签域，请先创建一个。</td>
              </tr>
            ) : items.map(ns => (
              <tr key={ns.id} className="border-t">
                <td className="p-3 font-medium">{ns.name}</td>
                <td className="max-w-[240px] truncate p-3 text-slate-600" title={ns.description || undefined}>{ns.description || '—'}</td>
                <td className="p-3">
                  <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-700">{ns.candidateThreshold}</span>
                </td>
                <td className="hidden max-w-[140px] truncate p-3 font-mono text-xs text-slate-400 lg:table-cell" title={ns.id}>{ns.id}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableShell>
    </section>
  )
}

function UsersPage() {
  const [users, setUsers] = useState<User[]>([])
  const [error, setError] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('reviewer')
  const [customPassword, setCustomPassword] = useState('')
  const [createdInfo, setCreatedInfo] = useState<{ user: User; initialPassword?: string } | null>(null)

  const reload = () => { api.users().then(res => setUsers(res.data)).catch(err => setError(err.message)) }
  useEffect(() => { reload() }, [])

  async function handleCreateUser(e: FormEvent) {
    e.preventDefault()
    setError('')
    setCreatedInfo(null)
    try {
      const res = await api.createUser({ email, role, password: customPassword || undefined })
      setCreatedInfo(res)
      setEmail('')
      setCustomPassword('')
      reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建用户失败')
    }
  }

  async function handleRoleChange(userId: string, newRole: Role) {
    try {
      await api.updateUserRole(userId, newRole)
      reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新角色失败')
    }
  }

  return (
    <section className="space-y-5">
      <PageHeader title="用户与角色管理" description="创建新用户、分配系统角色及审核权限。" />
      {error && <Notice message={error} />}

      <Panel title="创建新用户">
        <form onSubmit={handleCreateUser} className="flex flex-wrap items-end gap-3">
          <Field label="用户邮箱" className="min-w-[200px] flex-1">
            <input required type="email" placeholder="user@example.com" className={inputClass} value={email} onChange={e => setEmail(e.target.value)} />
          </Field>
          <Field label="系统角色">
            <select className={inputClass} value={role} onChange={e => setRole(e.target.value as Role)}>
              <option value="operator">Operator（导入）</option>
              <option value="reviewer">Reviewer（审核）</option>
              <option value="admin">Admin（管理）</option>
            </select>
          </Field>
          <Field label="初始密码（可空）" className="min-w-[160px] flex-1">
            <input type="text" placeholder="留空则随机生成" className={inputClass} value={customPassword} onChange={e => setCustomPassword(e.target.value)} />
          </Field>
          <button type="submit" className={btnPrimary}>创建账户</button>
        </form>
        {createdInfo && (
          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            <p className="font-semibold">用户创建成功</p>
            <p className="mt-1">
              账号：<code className="rounded bg-emerald-100 px-1">{createdInfo.user.email}</code>
              {' · '}角色：<code className="rounded bg-emerald-100 px-1">{createdInfo.user.role}</code>
            </p>
            {createdInfo.initialPassword && (
              <p className="mt-1">
                初始密码：
                <code className="rounded bg-emerald-200 px-2 py-0.5 font-mono font-bold">{createdInfo.initialPassword}</code>
                （请及时通知用户修改）
              </p>
            )}
          </div>
        )}
      </Panel>

      <TableShell>
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="p-3 font-medium">邮箱</th>
              <th className="p-3 font-medium">角色</th>
              <th className="p-3 font-medium">需改密</th>
              <th className="hidden p-3 font-medium md:table-cell">创建时间</th>
              <th className="p-3 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} className="border-t">
                <td className="max-w-[220px] truncate p-3 font-medium" title={u.email}>{u.email}</td>
                <td className="p-3">
                  <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-700">{u.role}</span>
                </td>
                <td className="p-3 text-slate-600">{u.mustChangePassword ? '是' : '否'}</td>
                <td className="hidden p-3 text-slate-500 md:table-cell">{u.createdAt ? new Date(u.createdAt).toLocaleString() : '—'}</td>
                <td className="p-3">
                  <select className="rounded border bg-white p-1 text-xs" value={u.role} onChange={e => handleRoleChange(u.id, e.target.value as Role)}>
                    <option value="operator">Operator</option>
                    <option value="reviewer">Reviewer</option>
                    <option value="admin">Admin</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableShell>
    </section>
  )
}

function useNamespaces() {
  const [items, setItems] = useState<Namespace[]>([])
  const [error, setError] = useState('')
  useEffect(() => { api.namespaces().then(x => setItems(x.data)).catch(e => setError(e.message)) }, [])
  return { items, error }
}

function NamespacePicker({ value, onChange, namespaces }: { value: string; onChange: (value: string) => void; namespaces: Namespace[] }) {
  return (
    <select className={`${inputClass} w-auto min-w-[160px]`} value={value} onChange={e => onChange(e.target.value)}>
      <option value="">选择标签域</option>
      {namespaces.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
    </select>
  )
}

function Dashboard({ isAdmin }: { isAdmin: boolean }) {
  const { items: namespaces, error } = useNamespaces()
  return (
    <section className="space-y-5">
      <PageHeader
        title="运营概览"
        description="管理标签命中、候选积压和人工审核。"
        actions={isAdmin ? (
          <NavLink to="/namespaces" className={btnPrimary}>创建标签域</NavLink>
        ) : undefined}
      />
      {error ? <Notice message={error} /> : <>
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <StatCard compact title="标签域" value={namespaces.length} detail="按业务域隔离规则和候选阈值" />
          <StatCard compact title="发布标签" value="—" detail="选择域后可在标签库查看" />
          <StatCard compact title="候选池" value="—" detail="达到阈值后自动创建汇总任务" />
          <StatCard compact title="待审核" value="—" detail="模型建议须人工批准才发布" />
        </div>
        <Panel title="开始使用">
          <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-600">
            <li>
              {isAdmin ? (
                <>
                  <NavLink to="/namespaces" className="font-medium text-brand hover:underline">创建一个标签域并设置候选池阈值</NavLink>。
                </>
              ) : (
                '请管理员创建一个标签域并设置候选池阈值。'
              )}
            </li>
            <li>导入首批标签，候选池任务会调用已配置的 OpenAI 兼容模型。</li>
            <li>在审核中心对模型建议进行逐项采纳、编辑与决策。</li>
          </ol>
        </Panel>
      </>}
    </section>
  )
}

function TagsPage() {
  const { items: namespaces, error } = useNamespaces()
  const [namespaceId, setNamespaceId] = useState('')
  const [query, setQuery] = useState('')
  const [tags, setTags] = useState<Tag[]>([])
  useEffect(() => { if (namespaceId) api.tags(namespaceId, query).then(x => setTags(x.data)).catch(() => setTags([])) }, [namespaceId, query])
  return (
    <section className="space-y-1">
      <PageHeader title="标签库" description="查看已发布的规范标签及其别名。" />
      <Toolbar>
        <NamespacePicker value={namespaceId} onChange={setNamespaceId} namespaces={namespaces} />
        <input className={`${inputClass} max-w-sm flex-1`} placeholder="搜索规范标签" value={query} onChange={e => setQuery(e.target.value)} />
      </Toolbar>
      {error && <Notice message={error} />}
      <div className="mt-5">
        <TableShell>
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="p-3 font-medium">规范标签</th>
                <th className="p-3 font-medium">别名</th>
                <th className="hidden p-3 font-medium md:table-cell">描述</th>
                <th className="p-3 font-medium">版本</th>
              </tr>
            </thead>
            <tbody>
              {tags.map(tag => (
                <tr key={tag.id} className="border-t">
                  <td className="p-3 font-medium">{tag.canonicalName}</td>
                  <td className="max-w-[200px] truncate p-3 text-slate-600" title={(tag.aliases || []).join('、') || undefined}>
                    {(tag.aliases || []).join('、') || '—'}
                  </td>
                  <td className="hidden max-w-[240px] truncate p-3 text-slate-600 md:table-cell" title={tag.description || undefined}>
                    {tag.description || '—'}
                  </td>
                  <td className="p-3 tabular-nums">v{tag.version}</td>
                </tr>
              ))}
              {namespaceId && tags.length === 0 && (
                <tr>
                  <td className="p-6 text-center text-slate-500" colSpan={4}>暂无已发布标签</td>
                </tr>
              )}
              {!namespaceId && (
                <tr>
                  <td className="p-6 text-center text-slate-500" colSpan={4}>请先选择标签域</td>
                </tr>
              )}
            </tbody>
          </table>
        </TableShell>
      </div>

      <div className="mt-6">
        <TagMatchSimulator namespaceId={namespaceId} />
      </div>
    </section>
  )
}

function TagMatchSimulator({ namespaceId }: { namespaceId: string }) {
  const [inputTags, setInputTags] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [response, setResponse] = useState<TagMatchResponse | null>(null)

  const handleMatch = async (e: FormEvent) => {
    e.preventDefault()
    if (!namespaceId) {
      setError('请先在上方选择标签域')
      return
    }
    const tags = inputTags.split(/[,，\n]/).map(s => s.trim()).filter(Boolean)
    if (tags.length === 0) {
      setError('请输入至少一个要比对的标签')
      return
    }
    setError('')
    setBusy(true)
    try {
      const res = await api.matchTags({ namespaceId, tags, sourceName: 'console_simulator' })
      setResponse(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : '匹配请求失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title="第三方 API 实时匹配测试器 (Tag Match Simulator)">
      <form onSubmit={handleMatch} className="space-y-3">
        <Field label="输入第三方不规范标签 (逗号或换行分隔)">
          <textarea
            className={`${inputClass} min-h-16 text-xs`}
            placeholder="例如: 自行车与机动车碰撞, 违规空域无人机黑飞"
            value={inputTags}
            onChange={e => setInputTags(e.target.value)}
          />
        </Field>
        <div className="flex justify-end">
          <button type="submit" disabled={busy || !namespaceId} className={btnPrimary}>
            {busy ? '匹配比对中…' : '发起 API 实时匹配测试'}
          </button>
        </div>
      </form>

      {error && <Notice message={error} />}

      {response && (
        <div className="mt-4 space-y-3 border-t border-slate-100 pt-3 text-xs">
          <div className="flex items-center gap-3">
            <span className="font-semibold text-slate-700">API 返回结果:</span>
            <span className="rounded bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-800 tabular-nums">
              命中 ({response.hitCount})
            </span>
            <span className="rounded bg-amber-100 px-2 py-0.5 font-semibold text-amber-800 tabular-nums">
              未命中/已自动入池 ({response.missCount})
            </span>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            {response.results.map((res, idx) => (
              <div
                key={idx}
                className={`rounded-lg border p-3 ${
                  res.hit ? 'border-emerald-200 bg-emerald-50/50' : 'border-amber-200 bg-amber-50/50'
                }`}
              >
                <div className="flex items-center justify-between gap-2 font-medium">
                  <span className="text-slate-900 font-semibold">{res.rawTag}</span>
                  {res.hit ? (
                    <span className="rounded bg-emerald-600 px-2 py-0.5 text-[11px] text-white font-semibold">
                      HIT (命中{res.matchedAs === 'alias' ? '别名' : '主标签'})
                    </span>
                  ) : (
                    <span className="rounded bg-amber-600 px-2 py-0.5 text-[11px] text-white font-semibold">
                      MISS (已收集入池)
                    </span>
                  )}
                </div>
                {res.hit && res.canonicalTag && (
                  <div className="mt-2 space-y-1 text-slate-700">
                    <p><span className="text-slate-500">主规范名:</span> <strong className="text-emerald-800">{res.canonicalTag.canonicalName}</strong></p>
                    {res.canonicalTag.description && <p className="text-slate-500 line-clamp-1">{res.canonicalTag.description}</p>}
                  </div>
                )}
                {!res.hit && (
                  <p className="mt-2 text-amber-800 leading-relaxed">{res.message}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </Panel>
  )
}

function ImportPage() {
  const { items: namespaces, error } = useNamespaces()
  const [namespaceId, setNamespaceId] = useState('')
  const [sourceName, setSourceName] = useState('')
  const [raw, setRaw] = useState('')
  const [initialSeed, setInitialSeed] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [message, setMessage] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setMessage('')
    setResult(null)
    const tags = raw.split(/\r?\n|,/).map(v => v.trim()).filter(Boolean)
    try {
      setResult(await api.importTags({ namespaceId, sourceName, tags, initialSeed }))
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '导入失败')
    }
  }

  return (
    <section className="space-y-5">
      <PageHeader title="批次导入" description="已命中的规范标签或别名不会新增；未命中项会累计到候选池。" />

      <Panel>
        <form onSubmit={submit} className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <NamespacePicker value={namespaceId} onChange={setNamespaceId} namespaces={namespaces} />
            <input
              className={`${inputClass} min-w-[200px] flex-1`}
              placeholder="来源名称，例如 2026-Q3 产品数据"
              value={sourceName}
              onChange={e => setSourceName(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={initialSeed} onChange={e => setInitialSeed(e.target.checked)} />
            首批基线标签：立即创建模型整理任务
          </label>
          <textarea
            className={`${inputClass} min-h-48 font-mono`}
            placeholder="每行一个标签，也可用逗号分隔"
            value={raw}
            onChange={e => setRaw(e.target.value)}
          />
          {(message || error) && <Notice message={message || error} />}
          <button disabled={!namespaceId || !raw.trim()} className={btnPrimary}>提交并处理</button>
        </form>
      </Panel>

      {result && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard compact title="总计" value={result.totalCount} detail="原始输入" />
            <StatCard compact title="已命中" value={result.matchedCount} detail="未新增标签" />
            <StatCard
              compact
              title="进入候选池"
              value={result.pooledCount}
              detail={typeof result.openCandidates === 'number' ? `未解决共 ${result.openCandidates}` : '等待阈值触发'}
            />
            <StatCard
              compact
              title="无效项"
              value={result.invalidCount}
              detail={typeof result.threshold === 'number' ? `阈值 ${result.threshold}` : '—'}
            />
          </div>
          {result.consolidationMessage && (
            <div className={`rounded-xl border p-4 text-sm ${
              result.consolidationStatus === 'created' || result.consolidationStatus === 'reclaimed'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                : result.consolidationStatus === 'already_active'
                  ? 'border-amber-200 bg-amber-50 text-amber-900'
                  : 'border-slate-200 bg-slate-50 text-slate-700'
            }`}>
              <p className="font-semibold">
                {result.consolidationStatus === 'created' && '已触发汇总'}
                {result.consolidationStatus === 'reclaimed' && '已回收卡住任务并重新入队'}
                {result.consolidationStatus === 'already_active' && '未新建任务（已有活跃窗口）'}
                {result.consolidationStatus === 'not_triggered' && '未触发汇总'}
                {!['created', 'reclaimed', 'already_active', 'not_triggered'].includes(result.consolidationStatus || '') && '汇总状态'}
              </p>
              <p className="mt-1">{result.consolidationMessage}</p>
              {result.jobId && <p className="mt-1 font-mono text-xs opacity-80">jobId: {result.jobId}</p>}
              {(result.consolidationStatus === 'created' || result.consolidationStatus === 'reclaimed' || result.consolidationStatus === 'already_active') && (
                <p className="mt-2 text-xs opacity-80">可到审核中心查看提案；若长时间没有结果，请检查 worker 日志与 LLM 配置。</p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}

function jobTypeLabel(job: ConsolidationJob) {
  if (job.jobType === 'rework' || job.parentProposalId) return '重跑'
  if (job.jobType === 'initial_seed' || job.triggerReason === 'initial_seed') return '首批'
  if (job.triggerReason === 'manual') return '手动'
  if (job.triggerReason === 'threshold') return '阈值'
  if (job.jobType === 'pool_window') return '归并'
  return job.jobType || '—'
}

function isActiveJobStatus(status: string) {
  return status === 'queued' || status === 'running' || status === 'retryable_failed'
}

function formatDateTime(value?: string) {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString()
}

function PoolPage({ canTrigger }: { canTrigger: boolean }) {
  const { items: namespaces } = useNamespaces()
  const [namespaceId, setNamespaceId] = useState('')
  const [items, setItems] = useState<PoolEntry[]>([])
  const [jobs, setJobs] = useState<ConsolidationJob[]>([])
  const [threshold, setThreshold] = useState(0)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [triggering, setTriggering] = useState(false)
  const [activeJobId, setActiveJobId] = useState<string | null>(null)

  const reloadPool = (id: string) => {
    api.pool(id).then(x => { setItems(x.data); setThreshold(x.threshold) }).catch(err => setError(err instanceof Error ? err.message : '加载候选池失败'))
  }

  const reloadJobs = (id: string) => {
    api.consolidationJobs(id)
      .then(x => setJobs(x.data))
      .catch(err => setError(err instanceof Error ? err.message : '加载归并任务失败'))
  }

  useEffect(() => {
    setError('')
    setMessage('')
    setActiveJobId(null)
    if (namespaceId) {
      reloadPool(namespaceId)
      reloadJobs(namespaceId)
    } else {
      setItems([])
      setJobs([])
      setThreshold(0)
    }
  }, [namespaceId])

  const hasActiveJobs = useMemo(() => jobs.some(j => isActiveJobStatus(j.status)), [jobs])

  useEffect(() => {
    if (!namespaceId || !hasActiveJobs) return
    const timer = window.setInterval(() => {
      reloadJobs(namespaceId)
      reloadPool(namespaceId)
    }, 4000)
    return () => window.clearInterval(timer)
  }, [namespaceId, hasActiveJobs])

  const progress = useMemo(() => threshold ? Math.min(100, Math.round(items.length / threshold * 100)) : 0, [items, threshold])
  const activeJob = useMemo(() => jobs.find(j => j.id === activeJobId) ?? null, [jobs, activeJobId])

  async function triggerNow() {
    if (!namespaceId || items.length === 0) return
    setError('')
    setMessage('')
    setTriggering(true)
    try {
      const result = await api.triggerConsolidation(namespaceId)
      const tone =
        result.consolidationStatus === 'created' || result.consolidationStatus === 'reclaimed'
          ? '已触发'
          : result.consolidationStatus === 'already_active'
            ? '未新建'
            : '状态'
      setMessage(`${tone}：${result.consolidationMessage}${result.jobId ? `（jobId: ${result.jobId}）` : ''}`)
      reloadPool(namespaceId)
      reloadJobs(namespaceId)
    } catch (err) {
      setError(err instanceof Error ? err.message : '手动触发失败')
    } finally {
      setTriggering(false)
    }
  }

  return (
    <section className="space-y-1">
      <PageHeader
        title="候选池"
        description="达到阈值时自动冻结；也可在未达阈值时手动触发归并。模型只处理冻结快照，避免新数据扰动审核。"
      />
      <Toolbar>
        <NamespacePicker value={namespaceId} onChange={setNamespaceId} namespaces={namespaces} />
        {canTrigger && namespaceId && (
          <button
            type="button"
            disabled={triggering || items.length === 0}
            onClick={() => void triggerNow()}
            className={btnPrimary}
            title={items.length === 0 ? '当前无开放候选' : '不等阈值，立即冻结并投递汇总任务'}
          >
            {triggering ? '触发中…' : '立即归并'}
          </button>
        )}
      </Toolbar>

      {error && <Notice message={error} />}
      {message && <SuccessNotice message={message} />}

      {namespaceId && (
        <div className="mt-5 space-y-5">
          <Panel>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>本轮候选 <strong className="tabular-nums">{items.length}</strong> / 阈值 <strong className="tabular-nums">{threshold}</strong></span>
              <span className="font-semibold text-brand tabular-nums">{progress}%</span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded bg-slate-100">
              <div className="h-full rounded bg-brand transition-all" style={{ width: `${progress}%` }} />
            </div>
            {canTrigger && items.length > 0 && items.length < threshold && (
              <p className="mt-3 text-xs text-slate-500">尚未达到自动阈值，可点「立即归并」用当前开放候选创建汇总任务。</p>
            )}
          </Panel>

          <TableShell>
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="p-3 font-medium">规范化值</th>
                  <th className="p-3 font-medium">原始样本</th>
                  <th className="p-3 font-medium">出现次数</th>
                  <th className="hidden p-3 font-medium md:table-cell">最近出现</th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <tr key={item.id} className="border-t">
                    <td className="p-3 font-medium">{item.normalizedName}</td>
                    <td className="max-w-[200px] truncate p-3" title={item.rawSample}>{item.rawSample}</td>
                    <td className="p-3 tabular-nums">{item.occurrenceCount}</td>
                    <td className="hidden p-3 text-slate-500 md:table-cell">{formatDateTime(item.lastSeenAt)}</td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr>
                    <td colSpan={4} className="p-6 text-center text-slate-500">当前域暂无未解决候选</td>
                  </tr>
                )}
              </tbody>
            </table>
          </TableShell>

          <div>
            <h2 className="mb-3 text-sm font-semibold text-ink">本域归并任务</h2>
            {jobs.length === 0 ? (
              <EmptyState title="本域暂无归并任务" description="阈值触发、首批种子或手动「立即归并」后，运行记录会出现在这里。" />
            ) : (
              <TableShell>
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="p-3 font-medium">时间</th>
                      <th className="p-3 font-medium">类型</th>
                      <th className="p-3 font-medium">任务状态</th>
                      <th className="p-3 font-medium">窗口</th>
                      <th className="p-3 font-medium">候选数</th>
                      <th className="p-3 font-medium">尝试</th>
                      <th className="p-3 font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map(job => (
                      <tr
                        key={job.id}
                        className="cursor-pointer border-t hover:bg-slate-50/80"
                        onClick={() => setActiveJobId(job.id)}
                      >
                        <td className="p-3 text-slate-600">{formatDateTime(job.createdAt)}</td>
                        <td className="p-3 font-medium">{jobTypeLabel(job)}</td>
                        <td className="p-3"><StatusBadge status={job.status} /></td>
                        <td className="p-3">{job.windowStatus ? <StatusBadge status={job.windowStatus} /> : <span className="text-slate-400">—</span>}</td>
                        <td className="p-3 tabular-nums">{job.snapshotCount}</td>
                        <td className="p-3 tabular-nums">{job.attempt}</td>
                        <td className="p-3">
                          <button
                            type="button"
                            className="text-sm font-semibold text-brand hover:underline"
                            onClick={e => { e.stopPropagation(); setActiveJobId(job.id) }}
                          >
                            查看
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableShell>
            )}
          </div>
        </div>
      )}

      {activeJob && (
        <Modal title={`归并任务 ${activeJob.id.slice(0, 8)}`} onClose={() => setActiveJobId(null)} wide>
          <div className="space-y-5 p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm">
                <p className="text-xs text-slate-500">任务 ID</p>
                <p className="mt-1 break-all font-mono text-xs text-ink">{activeJob.id}</p>
              </div>
              <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm">
                <p className="text-xs text-slate-500">类型 / 触发</p>
                <p className="mt-1 font-medium text-ink">
                  {jobTypeLabel(activeJob)}
                  {activeJob.triggerReason ? <span className="ml-2 text-xs font-normal text-slate-500">({activeJob.triggerReason})</span> : null}
                </p>
              </div>
              <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm">
                <p className="text-xs text-slate-500">任务状态</p>
                <div className="mt-1"><StatusBadge status={activeJob.status} /></div>
              </div>
              <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm">
                <p className="text-xs text-slate-500">窗口状态</p>
                <div className="mt-1">
                  {activeJob.windowStatus ? <StatusBadge status={activeJob.windowStatus} /> : <span className="text-slate-400">—</span>}
                </div>
              </div>
              <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm">
                <p className="text-xs text-slate-500">快照候选数</p>
                <p className="mt-1 tabular-nums font-medium">{activeJob.snapshotCount}</p>
              </div>
              <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm">
                <p className="text-xs text-slate-500">阈值 / 尝试</p>
                <p className="mt-1 tabular-nums font-medium">
                  {activeJob.threshold || '—'} / {activeJob.attempt}
                </p>
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold text-ink">时间线</h3>
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                <div className="flex justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2">
                  <dt className="text-slate-500">创建</dt>
                  <dd className="tabular-nums text-ink">{formatDateTime(activeJob.createdAt)}</dd>
                </div>
                <div className="flex justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2">
                  <dt className="text-slate-500">开始</dt>
                  <dd className="tabular-nums text-ink">{formatDateTime(activeJob.startedAt)}</dd>
                </div>
                <div className="flex justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2">
                  <dt className="text-slate-500">完成</dt>
                  <dd className="tabular-nums text-ink">{formatDateTime(activeJob.completedAt)}</dd>
                </div>
                <div className="flex justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2">
                  <dt className="text-slate-500">runAfter</dt>
                  <dd className="tabular-nums text-ink">{formatDateTime(activeJob.runAfter)}</dd>
                </div>
              </dl>
            </div>

            {activeJob.errorMessage && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                <p className="text-xs font-semibold text-red-800">错误信息</p>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm text-red-900">{activeJob.errorMessage}</p>
              </div>
            )}

            {activeJob.proposalId && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                <p className="font-semibold">已生成审核提案</p>
                <p className="mt-1 font-mono text-xs">{activeJob.proposalId}</p>
                {activeJob.proposalStatus && (
                  <p className="mt-2 flex items-center gap-2">
                    状态 <StatusBadge status={activeJob.proposalStatus} />
                  </p>
                )}
                <p className="mt-2 text-xs">可前往「审核中心」查看并处理该提案。</p>
              </div>
            )}

            {activeJob.parentProposalId && (
              <p className="text-xs text-slate-500">
                父提案：<span className="font-mono">{activeJob.parentProposalId}</span>
              </p>
            )}

            <div className="flex justify-end border-t border-slate-100 pt-3">
              <button type="button" className={btnSecondary} onClick={() => setActiveJobId(null)}>关闭</button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  )
}

interface ItemEditState {
  accepted: boolean
  canonicalName: string
  description: string
  aliases: string
}

type ReviewTab = 'pending' | 'reviewed'

function isPendingProposal(status: string) {
  return status === 'pending_review' || status === 'pending'
}

function buildItemEdits(proposal: Proposal): Record<string, ItemEditState> {
  const edits: Record<string, ItemEditState> = {}
  const tags = proposal.tags || []
  for (const tag of tags) {
    const aliases = tag.aliases || []
    edits[tag.id] = {
      accepted: tag.accepted ?? true,
      canonicalName: tag.canonicalName || '',
      description: tag.description || '',
      aliases: aliases.join(', '),
    }
  }
  return edits
}

function acceptedSummary(proposal: Proposal) {
  if (isPendingProposal(proposal.status)) return '—'
  const tags = proposal.tags || []
  const accepted = tags.filter(t => t.accepted === true).length
  return `${accepted} / ${tags.length}`
}

function ReviewPage() {
  const [tab, setTab] = useState<ReviewTab>('pending')
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [pendingCount, setPendingCount] = useState(0)
  const [reviewedCount, setReviewedCount] = useState(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [comments, setComments] = useState('')
  const [itemEdits, setItemEdits] = useState<Record<string, ItemEditState>>({})

  const reload = async (preferTab: ReviewTab = tab) => {
    setError('')
    try {
      const [pending, reviewed] = await Promise.all([
        api.proposals({ status: 'pending_review' }),
        api.proposals({ status: 'reviewed' }),
      ])
      setPendingCount(pending.data.length)
      setReviewedCount(reviewed.data.length)
      setProposals(preferTab === 'pending' ? pending.data : reviewed.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载提案失败')
    }
  }

  useEffect(() => {
    void reload(tab)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  const active = useMemo(() => proposals.find(p => p.id === activeId) ?? null, [proposals, activeId])

  function openProposal(proposal: Proposal) {
    setActiveId(proposal.id)
    setItemEdits(buildItemEdits(proposal))
    setComments(proposal.reviewerFeedback || '')
    setError('')
  }

  function closeModal() {
    setActiveId(null)
    setItemEdits({})
    setComments('')
    setBusy(false)
  }

  const updateItem = (tagId: string, patch: Partial<ItemEditState>) => {
    setItemEdits(prev => ({
      ...prev,
      [tagId]: { ...prev[tagId], ...patch } as ItemEditState,
    }))
  }

  async function decide(proposal: Proposal, action: 'approve' | 'reject' | 'discard') {
    setBusy(true)
    setError('')
    try {
      const tagPayloads = proposal.tags.map(t => {
        const edit = itemEdits[t.id]
        return {
          proposalTagId: t.id,
          accepted: edit ? edit.accepted : (t.accepted ?? true),
          canonicalName: edit ? edit.canonicalName.trim() : t.canonicalName,
          description: edit ? edit.description.trim() : t.description,
          aliases: edit ? edit.aliases.split(',').map(s => s.trim()).filter(Boolean) : t.aliases,
        }
      })
      await api.decideProposal(proposal.id, {
        approve: action === 'approve',
        action,
        version: proposal.version,
        comments,
        tags: tagPayloads,
      })
      closeModal()
      await reload(tab)
    } catch (err) {
      setError(err instanceof Error ? err.message : '审核提交失败')
    } finally {
      setBusy(false)
    }
  }

  const tabBtn = (key: ReviewTab, label: string, count: number) => (
    <button
      type="button"
      key={key}
      onClick={() => setTab(key)}
      className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
        tab === key ? 'bg-brand text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
      }`}
    >
      {label}
      <span className={`ml-1.5 tabular-nums ${tab === key ? 'text-white/90' : 'text-slate-400'}`}>({count})</span>
    </button>
  )

  return (
    <section className="space-y-1">
      <PageHeader
        title="审核中心"
        description="待审提案按行浏览，点击后在弹窗中逐项采纳或忽略；已处理提案可只读查看。"
      />
      <Toolbar>
        <div className="inline-flex flex-wrap gap-2">
          {tabBtn('pending', '待审核', pendingCount)}
          {tabBtn('reviewed', '已处理', reviewedCount)}
        </div>
      </Toolbar>

      {error && !active && <Notice message={error} />}

      <div className="mt-5">
        {proposals.length === 0 ? (
          <EmptyState
            title={tab === 'pending' ? '暂无待审核提案' : '暂无已处理提案'}
            description={
              tab === 'pending'
                ? '候选池达到阈值或手动归并后，worker 生成的提案会出现在这里。'
                : '批准或驳回后的提案会显示在此，便于回溯。'
            }
          />
        ) : (
          <TableShell>
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="p-3 font-medium">提案</th>
                  <th className="p-3 font-medium">状态</th>
                  <th className="p-3 font-medium">建议数</th>
                  <th className="p-3 font-medium">采纳</th>
                  <th className="hidden p-3 font-medium md:table-cell">时间</th>
                  <th className="p-3 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {proposals.map(proposal => (
                  <tr
                    key={proposal.id}
                    className="cursor-pointer border-t hover:bg-slate-50/80"
                    onClick={() => openProposal(proposal)}
                  >
                    <td className="p-3 font-semibold text-ink">
                      提案 <span className="font-mono text-xs sm:text-sm">{proposal.id.slice(0, 8)}</span>
                      <span className="ml-2 text-xs font-normal text-slate-400">v{proposal.version}</span>
                    </td>
                    <td className="p-3"><StatusBadge status={proposal.status} /></td>
                    <td className="p-3 tabular-nums">{proposal.tags.length}</td>
                    <td className="p-3 tabular-nums text-slate-600">{acceptedSummary(proposal)}</td>
                    <td className="hidden p-3 text-slate-500 md:table-cell">{new Date(proposal.createdAt).toLocaleString()}</td>
                    <td className="p-3">
                      <button
                        type="button"
                        className="text-sm font-semibold text-brand hover:underline"
                        onClick={e => { e.stopPropagation(); openProposal(proposal) }}
                      >
                        {isPendingProposal(proposal.status) ? '审核' : '查看'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        )}
      </div>

      {active && (
        <ProposalModal
          proposal={active}
          readonly={!isPendingProposal(active.status)}
          busy={busy}
          error={error}
          comments={comments}
          itemEdits={itemEdits}
          onComments={setComments}
          onUpdateItem={updateItem}
          onClose={closeModal}
          onDecide={action => void decide(active, action)}
        />
      )}
    </section>
  )
}

function ProposalModal({
  proposal,
  readonly,
  busy,
  error,
  comments,
  itemEdits,
  onComments,
  onUpdateItem,
  onClose,
  onDecide,
}: {
  proposal: Proposal
  readonly: boolean
  busy: boolean
  error: string
  comments: string
  itemEdits: Record<string, ItemEditState>
  onComments: (value: string) => void
  onUpdateItem: (tagId: string, patch: Partial<ItemEditState>) => void
  onClose: () => void
  onDecide: (action: 'approve' | 'reject' | 'discard') => void
}) {
  const [filterMode, setFilterMode] = useState<'all' | 'existing' | 'new'>('all')
  const [confidenceOperator, setConfidenceOperator] = useState<'>=' | '<='>('>=')
  const [confidenceValue, setConfidenceValue] = useState<string>('')
  const [coveredOperator, setCoveredOperator] = useState<'>=' | '<='>('>=')
  const [coveredValue, setCoveredValue] = useState<string>('')

  const [aiEvaluating, setAiEvaluating] = useState(false)
  const [aiError, setAiError] = useState('')
  const [aiResult, setAiResult] = useState<AIAuditEvaluateResponse | null>(null)
  const [showAIConfigModal, setShowAIConfigModal] = useState(false)
  const [aiConfig, setAiConfig] = useState<AIAuditConfig>(() => {
    try {
      const saved = localStorage.getItem('tagmanager_ai_audit_config')
      if (saved) return JSON.parse(saved)
    } catch {}
    return { baseUrl: '', apiKey: '', model: '', prompt: '' }
  })

  const handleAIEvaluate = async () => {
    setAiError('')
    setAiEvaluating(true)
    try {
      const res = await api.evaluateProposalAI(proposal.id, { config: aiConfig })
      setAiResult(res)
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'AI 助审评估请求失败')
    } finally {
      setAiEvaluating(false)
    }
  }

  const handleApplyAISuggestions = () => {
    if (!aiResult || !aiResult.tagAdvice) return
    const adviceMap = new Map<string, TagAIAdvice>()
    aiResult.tagAdvice.forEach(a => adviceMap.set(a.canonicalName, a))

    tags.forEach(t => {
      const advice = adviceMap.get(t.canonicalName)
      if (advice) {
        if (advice.recommendation === 'accept' || advice.recommendation === 'edit') {
          onUpdateItem(t.id, {
            accepted: true,
            canonicalName: advice.suggestedName ? advice.suggestedName : t.canonicalName,
          })
        } else if (advice.recommendation === 'reject') {
          onUpdateItem(t.id, { accepted: false })
        }
      }
    })
  }

  const tags = proposal.tags || []
  const existingCount = tags.filter(t => t.isExistingCanonical).length
  const newCount = tags.filter(t => !t.isExistingCanonical).length
  const acceptedCount = tags.filter(t => (itemEdits[t.id]?.accepted ?? t.accepted ?? true)).length

  const adviceMap = useMemo(() => {
    const map = new Map<string, TagAIAdvice>()
    if (aiResult?.tagAdvice) {
      aiResult.tagAdvice.forEach(a => map.set(a.canonicalName, a))
    }
    return map
  }, [aiResult])

  const visibleTags = tags.filter(t => {
    if (filterMode === 'existing' && !t.isExistingCanonical) return false
    if (filterMode === 'new' && t.isExistingCanonical) return false

    const confVal = parseFloat(confidenceValue)
    if (!isNaN(confVal) && confVal >= 0 && confVal <= 100) {
      const tagConfPct = Math.round(t.confidence * 100)
      if (confidenceOperator === '>=' && tagConfPct < confVal) return false
      if (confidenceOperator === '<=' && tagConfPct > confVal) return false
    }

    const covVal = parseInt(coveredValue, 10)
    if (!isNaN(covVal) && covVal >= 0) {
      const count = (t.coveredEntryIds || []).length
      if (coveredOperator === '>=' && count < covVal) return false
      if (coveredOperator === '<=' && count > covVal) return false
    }

    return true
  })

  function batchSetAccepted(targetTags: ProposalTag[], accepted: boolean) {
    targetTags.forEach(t => {
      onUpdateItem(t.id, { accepted })
    })
  }

  return (
    <Modal onClose={onClose} wide title={`提案 ${proposal.id.slice(0, 8)}`}>
      <div className="space-y-4 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={proposal.status} />
            <span>{new Date(proposal.createdAt).toLocaleString()}</span>
            <span>· v{proposal.version}</span>
            <span>· <span className="tabular-nums">{tags.length}</span> 项建议</span>
            <span>· 已采纳 <span className="tabular-nums font-medium text-emerald-700">{acceptedCount}</span></span>
          </div>

          {!readonly && (
            <div className="flex flex-wrap items-center gap-2">
              {existingCount > 0 && (
                <button
                  type="button"
                  onClick={() => batchSetAccepted(tags.filter(t => t.isExistingCanonical), true)}
                  className="rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
                >
                  一键采纳所有归入已有 ({existingCount})
                </button>
              )}
              <button
                type="button"
                onClick={() => batchSetAccepted(visibleTags, true)}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                采纳当前筛选 ({visibleTags.length})
              </button>
              <button
                type="button"
                onClick={handleAIEvaluate}
                disabled={aiEvaluating}
                className="rounded-lg border border-purple-300 bg-purple-50 px-2.5 py-1 text-xs font-semibold text-purple-800 hover:bg-purple-100 flex items-center gap-1"
              >
                {aiEvaluating ? '🤖 AI 评估中…' : '🤖 AI 智能助审'}
              </button>
              <button
                type="button"
                onClick={() => setShowAIConfigModal(true)}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                title="配置 AI 助审 Base URL, API Key, Model 与 Prompt"
              >
                ⚙️ 助审配置
              </button>
            </div>
          )}
        </div>

        {error && <Notice message={error} />}
        {aiError && <Notice message={aiError} />}

        {aiResult && (
          <div className="rounded-xl border border-purple-200 bg-purple-50/80 p-4 space-y-2 text-xs text-purple-950">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-bold text-purple-900">
                <span>🤖 AI 智能助审二次评估结论</span>
                <span className="rounded bg-purple-200 px-2 py-0.5 text-[11px] font-semibold text-purple-900">
                  {aiResult.tagAdvice.length} 项诊断建议
                </span>
              </div>
              {!readonly && (
                <button
                  type="button"
                  onClick={handleApplyAISuggestions}
                  className="rounded-lg bg-purple-700 px-3 py-1 text-xs font-semibold text-white hover:bg-purple-800 shadow-sm"
                >
                  一键应用 AI 智能选牌
                </button>
              )}
            </div>
            <p className="leading-relaxed text-purple-900 font-medium">{aiResult.overallSummary}</p>
          </div>
        )}

        <div className={readonly ? 'pointer-events-none opacity-70' : ''}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">模型建议列表</h3>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1">
                <span className="text-slate-500 font-medium">涵盖词数:</span>
                <select
                  value={coveredOperator}
                  onChange={e => setCoveredOperator(e.target.value as '>=' | '<=')}
                  className="rounded border border-slate-200 bg-white px-1.5 py-0.5 outline-none text-xs font-semibold text-slate-700"
                >
                  <option value=">=">&ge; (大于等于)</option>
                  <option value="<=">&le; (小于等于)</option>
                </select>
                <input
                  type="number"
                  min="0"
                  placeholder="如 3"
                  value={coveredValue}
                  onChange={e => setCoveredValue(e.target.value)}
                  className="w-14 rounded border border-slate-200 bg-white px-1.5 py-0.5 outline-none text-xs font-medium text-slate-800"
                />
                <span className="text-slate-500 font-medium">个</span>
                {coveredValue && (
                  <button
                    type="button"
                    onClick={() => setCoveredValue('')}
                    className="ml-1 text-xs text-slate-400 hover:text-slate-600"
                    title="重置涵盖词数筛选"
                  >
                    ✕
                  </button>
                )}
              </div>

              <div className="flex items-center gap-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1">
                <span className="text-slate-500 font-medium">置信度:</span>
                <select
                  value={confidenceOperator}
                  onChange={e => setConfidenceOperator(e.target.value as '>=' | '<=')}
                  className="rounded border border-slate-200 bg-white px-1.5 py-0.5 outline-none text-xs font-semibold text-slate-700"
                >
                  <option value=">=">&ge; (大于等于)</option>
                  <option value="<=">&le; (小于等于)</option>
                </select>
                <input
                  type="number"
                  min="0"
                  max="100"
                  placeholder="如 80"
                  value={confidenceValue}
                  onChange={e => setConfidenceValue(e.target.value)}
                  className="w-14 rounded border border-slate-200 bg-white px-1.5 py-0.5 outline-none text-xs font-medium text-slate-800"
                />
                <span className="text-slate-500 font-medium">%</span>
                {confidenceValue && (
                  <button
                    type="button"
                    onClick={() => setConfidenceValue('')}
                    className="ml-1 text-xs text-slate-400 hover:text-slate-600"
                    title="重置置信度筛选"
                  >
                    ✕
                  </button>
                )}
              </div>

              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5 text-xs font-medium">
                <button
                  type="button"
                  onClick={() => setFilterMode('all')}
                  className={`rounded-md px-2.5 py-1 ${filterMode === 'all' ? 'bg-white font-semibold text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  全部 ({tags.length})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterMode('existing')}
                  className={`rounded-md px-2.5 py-1 ${filterMode === 'existing' ? 'bg-white font-semibold text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  归入已有 ({existingCount})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterMode('new')}
                  className={`rounded-md px-2.5 py-1 ${filterMode === 'new' ? 'bg-white font-semibold text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  建议新建 ({newCount})
                </button>
              </div>
            </div>
          </div>

          {visibleTags.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">
              当前筛选模式下暂无匹配的建议项
            </div>
          ) : (
            <div className="grid gap-3 xl:grid-cols-2">
              {visibleTags.map(tag => {
                const aliases = tag.aliases || []
                const coveredEntryIds = tag.coveredEntryIds || []
                const edit = itemEdits[tag.id] ?? {
                  accepted: tag.accepted ?? true,
                  canonicalName: tag.canonicalName || '',
                  description: tag.description || '',
                  aliases: aliases.join(', '),
                }
                const advice = adviceMap.get(tag.canonicalName)
                return (
                  <div
                    key={tag.id}
                    className={`min-w-0 rounded-xl border p-3 sm:p-4 ${
                      edit.accepted ? 'border-slate-200 bg-slate-50/40' : 'border-red-200 bg-red-50/40'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="inline-flex overflow-hidden rounded-lg border border-slate-200 bg-white text-xs font-semibold">
                          <button
                            type="button"
                            title="采纳"
                            disabled={readonly}
                            onClick={() => onUpdateItem(tag.id, { accepted: true })}
                            className={`px-2.5 py-1 ${edit.accepted ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
                          >
                            采纳
                          </button>
                          <button
                            type="button"
                            title="忽略"
                            disabled={readonly}
                            onClick={() => onUpdateItem(tag.id, { accepted: false })}
                            className={`px-2.5 py-1 ${!edit.accepted ? 'bg-slate-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
                          >
                            忽略
                          </button>
                        </div>
                        {tag.isExistingCanonical ? (
                          <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-100/80 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                            归入已有主标签
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-100/80 px-2 py-0.5 text-[11px] font-semibold text-indigo-800">
                            建议新建主标签
                          </span>
                        )}
                        {advice && (
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                              advice.recommendation === 'accept'
                                ? 'border-emerald-300 bg-emerald-100 text-emerald-800'
                                : advice.recommendation === 'edit'
                                ? 'border-amber-300 bg-amber-100 text-amber-800'
                                : 'border-rose-300 bg-rose-100 text-rose-800'
                            }`}
                          >
                            🤖 AI建议: {advice.recommendation === 'accept' ? '采纳' : advice.recommendation === 'edit' ? '修改' : '忽略'}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <span className="rounded bg-brand/10 px-2 py-0.5 font-semibold text-brand tabular-nums">
                          {Math.round(tag.confidence * 100)}%
                        </span>
                        <span className="rounded-md bg-slate-100 px-2 py-0.5 font-medium text-slate-700 tabular-nums border border-slate-200">
                          涵盖 {coveredEntryIds.length} 个候选词
                        </span>
                      </div>
                    </div>

                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <Field label="规范名">
                        <input
                          disabled={!edit.accepted || readonly}
                          className={`${inputClass} py-1.5 font-medium`}
                          value={edit.canonicalName}
                          onChange={e => onUpdateItem(tag.id, { canonicalName: e.target.value })}
                        />
                      </Field>
                      <Field label="新增别名 (逗号分隔)">
                        <input
                          disabled={!edit.accepted || readonly}
                          className={`${inputClass} py-1.5`}
                          value={edit.aliases}
                          onChange={e => onUpdateItem(tag.id, { aliases: e.target.value })}
                        />
                      </Field>
                      <Field label="描述" className="sm:col-span-2">
                        <input
                          disabled={!edit.accepted || readonly}
                          className={`${inputClass} py-1.5`}
                          value={edit.description}
                          onChange={e => onUpdateItem(tag.id, { description: e.target.value })}
                        />
                      </Field>
                    </div>
                    {tag.rationale && (
                      <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-slate-500" title={tag.rationale}>
                        理由：{tag.rationale}
                      </p>
                    )}
                    {advice && (
                      <div className="mt-2 rounded-lg bg-purple-50 p-2.5 text-xs text-purple-900 border border-purple-200">
                        <div className="flex items-center justify-between font-semibold text-purple-950">
                          <span>🤖 AI 助审观点:</span>
                          {advice.suggestedName && (
                            <span className="text-[11px] text-purple-700">推荐更优规范名: <strong>{advice.suggestedName}</strong></span>
                          )}
                        </div>
                        <p className="mt-1 text-purple-800 leading-relaxed">{advice.reason}</p>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          <div className="mt-4">
            <Field label={readonly ? '审核意见' : '审核意见 / 驳回或终止说明'}>
              <textarea
                disabled={readonly}
                className={`${inputClass} min-h-20`}
                placeholder="驳回或终止时填写说明，例如：放弃旧快照，包含最新候选重新汇总"
                value={comments}
                onChange={e => onComments(e.target.value)}
              />
            </Field>
          </div>
        </div>
      </div>

      {!readonly && (
        <div className="sticky bottom-0 flex flex-col-reverse gap-2 border-t border-slate-100 bg-white px-5 py-3 sm:flex-row sm:justify-end">
          <button type="button" disabled={busy} onClick={onClose} className={btnSecondary}>取消</button>
          <button type="button" disabled={busy} onClick={() => onDecide('discard')} className={btnWarning}>
            {busy ? '提交中…' : '终止提案'}
          </button>
          <button type="button" disabled={busy} onClick={() => onDecide('reject')} className={btnDanger}>
            {busy ? '提交中…' : '驳回重跑'}
          </button>
          <button type="button" disabled={busy} onClick={() => onDecide('approve')} className={btnSuccess}>
            {busy ? '提交中…' : `批准提交（${acceptedCount}/${proposal.tags.length}）`}
          </button>
        </div>
      )}

      {showAIConfigModal && (
        <AIAuditConfigModal
          config={aiConfig}
          onSave={setAiConfig}
          onClose={() => setShowAIConfigModal(false)}
        />
      )}
    </Modal>
  )
}

function ApiDocsPage() {
  const [keys, setKeys] = useState<APIKey[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createdResult, setCreatedResult] = useState<{ name: string; rawKey: string } | null>(null)
  const [activeCodeTab, setActiveCodeTab] = useState<'curl' | 'js' | 'python'>('curl')
  const [copied, setCopied] = useState(false)

  const loadKeys = () => {
    setLoading(true)
    api.apiKeys()
      .then(x => setKeys(x.data))
      .catch(err => setError(err instanceof Error ? err.message : '无法加载 API Keys'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadKeys() }, [])

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault()
    if (!newKeyName.trim()) return
    setCreating(true)
    setError('')
    try {
      const res = await api.createAPIKey(newKeyName.trim())
      setCreatedResult({ name: res.apiKey.name, rawKey: res.rawKey })
      setShowCreateModal(false)
      setNewKeyName('')
      loadKeys()
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建 API Key 失败')
    } finally {
      setCreating(false)
    }
  }

  const handleRevoke = async (keyId: string, name: string) => {
    if (!window.confirm(`确定要撤销 API Key "${name}" 吗？撤销后使用此 Key 的第三方系统将立刻无法调用接口。`)) return
    try {
      await api.revokeAPIKey(keyId)
      loadKeys()
    } catch (err) {
      alert(err instanceof Error ? err.message : '撤销失败')
    }
  }

  const apiHost = window.location.origin
  const exampleEndpoint = `${apiHost}/api/v1/tags/match`
  const activeKeyPrefix = keys.find(k => k.status === 'active')?.keyPrefix
  const exampleKey = activeKeyPrefix ? `${activeKeyPrefix}...` : 'tm_live_YOUR_API_KEY'

  const codeSnippets = {
    curl: `curl -X POST "${exampleEndpoint}" \\
  -H "Authorization: Bearer ${exampleKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "namespaceId": "YOUR_NAMESPACE_ID",
    "tags": ["自行车与机动车碰撞", "违规空域无人机黑飞"],
    "sourceName": "third_party_app"
  }'`,
    js: `// JavaScript (Fetch / Node.js 18+)
const response = await fetch('${exampleEndpoint}', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ${exampleKey}',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    namespaceId: 'YOUR_NAMESPACE_ID',
    tags: ['自行车与机动车碰撞', '违规空域无人机黑飞'],
    sourceName: 'third_party_app'
  })
});

const data = await response.json();
console.log(data);`,
    python: `# Python (requests)
import requests

url = "${exampleEndpoint}"
headers = {
    "Authorization": "Bearer ${exampleKey}",
    "Content-Type": "application/json"
}
payload = {
    "namespaceId": "YOUR_NAMESPACE_ID",
    "tags": ["自行车与机动车碰撞", "违规空域无人机黑飞"],
    "sourceName": "third_party_app"
}

response = requests.post(url, headers=headers, json=payload)
data = response.json()
print(data)`,
  }

  const handleCopyCode = () => {
    navigator.clipboard.writeText(codeSnippets[activeCodeTab])
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <section className="space-y-6">
      <PageHeader
        title="API 开放接入与 Key 管理"
        description="创建 API Key 并通过开放 API 将第三方系统的标签实时接入比对及候选词自收录。"
      />

      {error && <Notice message={error} />}

      {createdResult && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-emerald-900">API Key 创建成功！</h4>
            <button
              onClick={() => setCreatedResult(null)}
              className="text-xs text-emerald-700 hover:text-emerald-900"
            >
              关闭提示
            </button>
          </div>
          <p className="text-xs text-emerald-800">
            密钥 <strong>{createdResult.name}</strong> 已生成。请妥善保存以下全量 Secret，系统不会二次展示：
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded bg-white px-3 py-2 font-mono text-xs text-emerald-950 font-bold border border-emerald-200 select-all">
              {createdResult.rawKey}
            </code>
            <button
              onClick={() => {
                navigator.clipboard.writeText(createdResult.rawKey)
                alert('API Key 已复制到剪贴板！')
              }}
              className="rounded bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
            >
              复制 Secret
            </button>
          </div>
        </div>
      )}

      {/* API Key 管理板块 */}
      <Panel title="API Key 密钥列表" description="第三方系统接入所需的独立鉴权 API Key">
        <div className="mb-4 flex justify-end">
          <button className={btnPrimary} onClick={() => setShowCreateModal(true)}>
            + 生成新 API Key
          </button>
        </div>
        {loading ? (
          <div className="p-4 text-center text-xs text-slate-500">正在加载 API Keys…</div>
        ) : keys.length === 0 ? (
          <EmptyState title="暂无 API Key" description="请点击上方生成您的第一个 API Key 用于第三方系统鉴权。" />
        ) : (
          <TableShell>
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="p-3 font-medium">Key 名称</th>
                  <th className="p-3 font-medium">Key 前缀</th>
                  <th className="p-3 font-medium">状态</th>
                  <th className="p-3 font-medium">创建时间</th>
                  <th className="p-3 font-medium">最后使用时间</th>
                  <th className="p-3 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {keys.map(k => (
                  <tr key={k.id} className="border-t text-xs">
                    <td className="p-3 font-medium text-slate-900">{k.name}</td>
                    <td className="p-3 font-mono text-slate-600">{k.keyPrefix}…</td>
                    <td className="p-3">
                      {k.status === 'active' ? (
                        <span className="rounded bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-800">有效</span>
                      ) : (
                        <span className="rounded bg-slate-100 px-2 py-0.5 font-semibold text-slate-500">已撤销</span>
                      )}
                    </td>
                    <td className="p-3 text-slate-500">{new Date(k.createdAt).toLocaleString('zh-CN')}</td>
                    <td className="p-3 text-slate-500">
                      {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString('zh-CN') : '尚未调用'}
                    </td>
                    <td className="p-3 text-right">
                      {k.status === 'active' && (
                        <button
                          onClick={() => handleRevoke(k.id, k.name)}
                          className="font-medium text-rose-600 hover:underline"
                        >
                          撤销
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        )}
      </Panel>

      {/* 接口文档与多语言代码板块 */}
      <Panel title="实时匹配 API 接入文档 (POST /api/v1/tags/match)">
        <div className="space-y-4 text-xs text-slate-700 leading-relaxed">
          <div className="rounded-lg bg-slate-50 p-3 space-y-2 border">
            <div className="flex items-center gap-2">
              <span className="rounded bg-emerald-600 px-2 py-0.5 text-xs font-bold text-white">POST</span>
              <code className="font-mono text-slate-900 font-semibold">{exampleEndpoint}</code>
            </div>
            <p className="text-slate-600">
              用于第三方系统实时传入一个或多个不规范标签文本。如果命中已发布规范主标签或别名，即刻返回规范主标签信息；若未命中，系统自动将该标签收集入候选词池累加词频，并在达到阈值时自动触发大模型归并。
            </p>
          </div>

          <div className="space-y-2">
            <h4 className="font-semibold text-slate-900">鉴权方式 (Headers)</h4>
            <ul className="list-disc pl-5 space-y-1">
              <li>标准方式：<code>Authorization: Bearer tm_live_...</code></li>
              <li>自定义头方式：<code>X-API-Key: tm_live_...</code></li>
            </ul>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-slate-900">多语言接入代码示例</h4>
              <button
                onClick={handleCopyCode}
                className="rounded border bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50"
              >
                {copied ? '已复制代码！' : '复制代码'}
              </button>
            </div>

            <div className="flex gap-2 border-b">
              {(['curl', 'js', 'python'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveCodeTab(tab)}
                  className={`px-3 py-1.5 font-semibold text-xs border-b-2 transition-colors ${
                    activeCodeTab === tab
                      ? 'border-brand text-brand'
                      : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {tab === 'curl' ? 'cURL' : tab === 'js' ? 'JavaScript / Node.js' : 'Python (requests)'}
                </button>
              ))}
            </div>

            <pre className="overflow-x-auto rounded-lg bg-slate-900 p-4 font-mono text-xs text-slate-100 leading-relaxed">
              <code>{codeSnippets[activeCodeTab]}</code>
            </pre>
          </div>

          <div className="space-y-2 border-t pt-3">
            <h4 className="font-semibold text-slate-900">响应 Schema 结构示例</h4>
            <pre className="overflow-x-auto rounded-lg bg-slate-100 p-3 font-mono text-[11px] text-slate-800">
{`{
  "hitCount": 1,
  "missCount": 1,
  "results": [
    {
      "rawTag": "自行车与机动车碰撞",
      "hit": true,
      "matchedAs": "alias", // "canonical" | "alias"
      "canonicalTag": {
        "id": "tag-001",
        "canonicalName": "交通事故与交通违法",
        "description": "车辆碰撞等事故",
        "version": 1
      },
      "message": "成功匹配已发布规范标签"
    },
    {
      "rawTag": "违规空域无人机黑飞",
      "hit": false,
      "message": "未匹配到规范标签，已自动收集入候选词池，建议先跳过此数据"
    }
  ]
}`}
            </pre>
          </div>
        </div>
      </Panel>

      {/* 创建 Key 弹窗 */}
      {showCreateModal && (
        <Modal title="生成新 API Key" onClose={() => setShowCreateModal(false)}>
          <form onSubmit={handleCreate} className="space-y-4">
            <Field label="Key 名称 / 接入系统标识">
              <input
                className={inputClass}
                placeholder="例如：订单系统标签匹配服务"
                value={newKeyName}
                onChange={e => setNewKeyName(e.target.value)}
                autoFocus
              />
            </Field>
            <p className="text-xs text-slate-500">
              API Key 生成后将获得 <code>tm_live_...</code> 开头的独立调用密钥，用于第三方 HTTP 请求鉴权。
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" className={btnSecondary} onClick={() => setShowCreateModal(false)}>
                取消
              </button>
              <button type="submit" disabled={creating || !newKeyName.trim()} className={btnPrimary}>
                {creating ? '生成中…' : '立即生成'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  )
}

function AIAuditConfigModal({
  config,
  onSave,
  onClose,
}: {
  config: AIAuditConfig
  onSave: (cfg: AIAuditConfig) => void
  onClose: () => void
}) {
  const [baseUrl, setBaseUrl] = useState(config.baseUrl || '')
  const [apiKey, setApiKey] = useState(config.apiKey || '')
  const [model, setModel] = useState(config.model || '')
  const [prompt, setPrompt] = useState(config.prompt || '')

  const defaultPrompt = "你是一名严谨的企业级标签体系审核专家。你的任务是评估大模型自动总结产生的【待审核标签提案】。你需要针对提案中的每一个拟发布规范标签及其别名、受支撑涵盖候选词进行质量诊断与冲突排查，给出现场审核改进建议。请严格按照 JSON Schema 格式返回 JSON 结果。"

  const handleSave = (e: FormEvent) => {
    e.preventDefault()
    const updated = { baseUrl, apiKey, model, prompt }
    localStorage.setItem('tagmanager_ai_audit_config', JSON.stringify(updated))
    onSave(updated)
    onClose()
  }

  return (
    <Modal title="⚙️ AI 助审大模型与提示词配置" onClose={onClose}>
      <form onSubmit={handleSave} className="space-y-4 px-1 py-2 text-xs">
        <Field label="Base URL (OpenAI 兼容 Endpoint)">
          <input
            className={inputClass}
            placeholder="留空默认使用后端 LLM_BASE_URL (如 https://api.openai.com/v1)"
            value={baseUrl}
            onChange={e => setBaseUrl(e.target.value)}
          />
        </Field>
        <Field label="API Key">
          <input
            type="password"
            className={inputClass}
            placeholder="留空默认使用后端 LLM_API_KEY"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
          />
        </Field>
        <Field label="Model Name (模型名称)">
          <input
            className={inputClass}
            placeholder="留空默认使用后端 LLM_MODEL (如 gpt-4o-mini / deepseek-chat)"
            value={model}
            onChange={e => setModel(e.target.value)}
          />
        </Field>
        <Field label="System Prompt (助审系统提示词)">
          <textarea
            className={`${inputClass} min-h-24 text-xs leading-relaxed`}
            placeholder="定义 AI 助审专家的评估准则"
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
          />
          <div className="flex justify-end mt-1">
            <button
              type="button"
              onClick={() => setPrompt(defaultPrompt)}
              className="text-[11px] text-brand hover:underline font-medium"
            >
              重置为默认提示词
            </button>
          </div>
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className={btnSecondary} onClick={onClose}>取消</button>
          <button type="submit" className={btnPrimary}>保存配置</button>
        </div>
      </form>
    </Modal>
  )
}
