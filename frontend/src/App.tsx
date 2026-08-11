import { Component, ErrorInfo, FormEvent, ReactNode, useEffect, useMemo, useState } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { api } from './lib/api'
import type { AIAuditConfig, AIAuditEvaluateResponse, APIKey, ConsolidationJob, ExtractAndMatchRequest, ExtractAndMatchResponse, ImportResult, LLMServiceConfig, Namespace, PoolEntry, Proposal, ProposalTag, Role, SystemSettingsPayload, Tag, TagAIAdvice, TagMatchItemResult, TagMatchResponse, User } from './types/api'
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
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return (localStorage.getItem('tagmanager_theme') as 'light' | 'dark') || 'light'
  })

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
    localStorage.setItem('tagmanager_theme', theme)
  }, [theme])

  const toggleTheme = () => {
    setTheme(prev => (prev === 'light' ? 'dark' : 'light'))
  }

  useEffect(() => {
    if (!localStorage.getItem('tagmanager-token')) {
      setLoading(false)
      return
    }
    api.me().then(setUser).catch(() => localStorage.removeItem('tagmanager-token')).finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="grid min-h-screen place-items-center text-slate-500 dark:text-slate-400">正在载入控制台…</div>
  if (!user) return <Login onLogin={setUser} />

  const menuItems = [
    { to: '/', label: '概览大盘', icon: '📊' },
    { to: '/tags', label: '标签知识库', icon: '🏷️' },
    { to: '/imports', label: '数据批次导入', icon: '📥' },
    { to: '/pool', label: '候选词缓冲池', icon: '🌊' },
    { to: '/review', label: '智能助审中心', icon: '⚖️' },
    { to: '/api-docs', label: 'API 开放接入', icon: '🔌' },
    ...(user.role === 'admin'
      ? [
          { to: '/namespaces', label: '标签域管理', icon: '🌐' },
          { to: '/users', label: '系统用户管理', icon: '👥' },
          { to: '/settings', label: '系统设置中心', icon: '⚙️' },
        ]
      : []),
  ]

  return (
    <div className="min-h-screen text-slate-800 dark:text-slate-100 p-4 sm:p-6 transition-colors duration-200">
      <div className="mx-auto flex max-w-[1600px] gap-5 items-start">
        {/* Floating Left Sidebar Card */}
        <aside className="sticky top-5 h-[calc(100vh-2.5rem)] max-h-[calc(100vh-2.5rem)] w-64 shrink-0 flex flex-col justify-between rounded-2xl glass-panel p-4 select-none overflow-hidden">
          <div className="flex flex-col min-h-0 flex-1 space-y-4">
            {/* Brand Logo & Subtitle */}
            <div className="flex items-center gap-3 px-2 pt-2 shrink-0">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-brand to-indigo-600 font-bold text-white shadow-md shadow-brand/20">
                🏷️
              </div>
              <div className="min-w-0">
                <h1 className="text-base font-extrabold tracking-tight text-slate-900 dark:text-white">TagManager</h1>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">LLM 智能归并与治理平台</p>
              </div>
            </div>

            {/* Navigation Items (Smooth hidden scrollbar) */}
            <nav className="space-y-1 min-h-0 flex-1 overflow-y-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
              {menuItems.map(item => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) =>
                    `group relative flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm transition-all duration-150 select-none ${
                      isActive
                        ? 'bg-brand text-white shadow-md shadow-brand/25 font-bold tracking-wide ring-1 ring-brand/40'
                        : 'font-medium text-slate-600 hover:bg-slate-100/90 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/70 dark:hover:text-slate-100'
                    }`
                  }
                >
                  <span className="text-base transition-transform group-hover:scale-110">{item.icon}</span>
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </nav>
          </div>

          {/* Compact Sidebar Footer: User Profile + Theme & Logout */}
          <div className="shrink-0 pt-2.5 border-t border-white/40 dark:border-white/10">
            <div className="rounded-xl glass-soft p-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-xs font-extrabold text-indigo-700 dark:bg-indigo-950/80 dark:text-indigo-300">
                    {user.email.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-bold text-slate-800 dark:text-slate-200" title={user.email}>
                      {user.email.split('@')[0]}
                    </p>
                    <span className="inline-block rounded bg-slate-200/70 px-1.5 py-0.2 text-[9px] font-mono font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                      {user.role}
                    </span>
                  </div>
                </div>

                {/* Compact Action Buttons: Theme Switcher & Logout */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={toggleTheme}
                    className="flex h-7 w-7 items-center justify-center rounded-lg glass-soft text-xs text-slate-700 hover:text-slate-900 dark:text-slate-200 dark:hover:text-white transition-colors cursor-pointer"
                    title={theme === 'dark' ? '切换为明亮模式' : '切换为暗色模式'}
                  >
                    {theme === 'dark' ? '🌙' : '☀️'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      localStorage.removeItem('tagmanager-token')
                      setUser(null)
                    }}
                    className="flex h-7 w-7 items-center justify-center rounded-lg glass-soft text-xs text-rose-600 hover:text-rose-700 dark:text-rose-400 dark:hover:text-rose-300 transition-colors cursor-pointer"
                    title="退出当前登录账号"
                  >
                    🚪
                  </button>
                </div>
              </div>
            </div>
          </div>
        </aside>

        {/* Floating Main Content Card */}
        <main className="min-w-0 flex-1 min-h-[calc(100vh-2.5rem)] rounded-2xl glass-panel p-6 sm:p-8">
          <Routes>
            <Route path="/" element={<Dashboard isAdmin={user.role === 'admin'} />} />
            <Route path="/tags" element={<TagsPage />} />
            <Route path="/imports" element={<ImportPage />} />
            <Route path="/pool" element={<PoolPage canTrigger={user.role === 'admin'} />} />
            <Route path="/review" element={<ReviewPage />} />
            <Route path="/api-docs" element={<ApiDocsPage />} />
            <Route path="/settings" element={user.role === 'admin' ? <SettingsPage /> : <Navigate to="/" />} />
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
    <div className="grid min-h-screen place-items-center p-5">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl glass-panel p-7">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">标签管理库</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">使用账号进入控制台。</p>
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
    <div className="fixed inset-0 z-50 grid place-items-center glass-overlay p-4">
      <div className="w-full max-w-md rounded-2xl glass-panel p-6">
        <h2 className="text-xl font-bold text-slate-900 dark:text-white">修改当前账号密码</h2>
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

  // Edit modal state
  const [editingNs, setEditingNs] = useState<Namespace | null>(null)
  const [editDescription, setEditDescription] = useState('')
  const [editThreshold, setEditThreshold] = useState(50)
  const [editSubmitting, setEditSubmitting] = useState(false)

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

  function handleOpenEdit(ns: Namespace) {
    setEditingNs(ns)
    setEditDescription(ns.description || '')
    setEditThreshold(ns.candidateThreshold)
  }

  async function handleSaveEdit(e: FormEvent) {
    e.preventDefault()
    if (!editingNs) return
    if (!Number.isInteger(editThreshold) || editThreshold < 1) {
      setError('候选池阈值必须是大于 0 的整数')
      return
    }
    setError('')
    setSuccess('')
    setEditSubmitting(true)
    try {
      const updated = await api.updateNamespace(editingNs.id, {
        description: editDescription.trim(),
        candidateThreshold: editThreshold,
      })
      setSuccess(`标签域「${updated.name}」已更新！功能描述与触发阈值已生效。`)
      setEditingNs(null)
      reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新标签域失败')
    } finally {
      setEditSubmitting(false)
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

      <Panel title="🌐 创建新标签域" description="默认阈值 50；设为较小值（如 5）便于联调测试。可在下方列表中随时编辑功能描述与触发阈值。">
        <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-3.5 pt-1">
          <Field label="标签域名称" className="min-w-[180px] flex-1">
            <input required placeholder="例如：产品能力 / 行业主题" className={inputClass} value={name} onChange={e => setName(e.target.value)} />
          </Field>
          <Field label="功能描述（可选）" className="min-w-[220px] flex-[2]">
            <input placeholder="用于描述该标签域的应用场景与归并目标" className={inputClass} value={description} onChange={e => setDescription(e.target.value)} />
          </Field>
          <Field label="自动归并触发阈值" className="w-36">
            <input required type="number" min={1} step={1} className={inputClass} value={candidateThreshold} onChange={e => setCandidateThreshold(Number(e.target.value))} />
          </Field>
          <button type="submit" disabled={submitting} className={btnPrimary}>
            {submitting ? '创建中…' : '➕ 确认创建标签域'}
          </button>
        </form>
      </Panel>

      <TableShell>
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead className="bg-slate-50/90 dark:bg-slate-800/80 border-b border-slate-200/80 dark:border-slate-800 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            <tr>
              <th className="py-3.5 px-4 sm:px-5">标签域名称</th>
              <th className="py-3.5 px-4 sm:px-5">功能描述</th>
              <th className="py-3.5 px-4 sm:px-5">触发阈值</th>
              <th className="hidden py-3.5 px-4 sm:px-5 lg:table-cell">系统 ID</th>
              <th className="py-3.5 px-4 sm:px-5 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
            {items.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-8 text-center text-slate-500 dark:text-slate-400">暂无已创建的标签域，请在上方卡片中先创建一个。</td>
              </tr>
            ) : items.map(ns => (
              <tr key={ns.id} className="transition-colors hover:bg-slate-50/60 dark:hover:bg-slate-800/50">
                <td className="py-3.5 px-4 sm:px-5 font-bold text-slate-900 dark:text-slate-100">{ns.name}</td>
                <td className="max-w-[280px] truncate py-3.5 px-4 sm:px-5 text-slate-600 dark:text-slate-300" title={ns.description || undefined}>{ns.description || '—'}</td>
                <td className="py-3.5 px-4 sm:px-5">
                  <span className="rounded-md bg-slate-100 px-2.5 py-1 font-mono text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-200/60 dark:border-slate-700/60">{ns.candidateThreshold}</span>
                </td>
                <td className="hidden max-w-[140px] truncate py-3.5 px-4 sm:px-5 font-mono text-xs text-slate-400 dark:text-slate-500 lg:table-cell" title={ns.id}>{ns.id}</td>
                <td className="py-3.5 px-4 sm:px-5 text-right">
                  <button
                    onClick={() => handleOpenEdit(ns)}
                    className="font-medium text-brand hover:underline"
                  >
                    ✏️ 编辑
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableShell>

      {editingNs && (
        <Modal title={`编辑标签域「${editingNs.name}」`} onClose={() => setEditingNs(null)}>
          <form onSubmit={handleSaveEdit} className="space-y-4">
            <Field label="标签域名称">
              <input disabled className={`${inputClass} bg-slate-100 dark:bg-slate-800 cursor-not-allowed text-slate-500`} value={editingNs.name} />
            </Field>
            <Field label="功能描述">
              <textarea
                className={`${inputClass} min-h-[80px]`}
                value={editDescription}
                onChange={e => setEditDescription(e.target.value)}
                placeholder="用于描述该标签域的应用场景与归并目标"
              />
            </Field>
            <Field label="自动归并触发阈值">
              <input
                required
                type="number"
                min={1}
                step={1}
                className={inputClass}
                value={editThreshold}
                onChange={e => setEditThreshold(Number(e.target.value))}
              />
              <p className="mt-1 text-[11px] text-slate-500">未命中候选词在该标签域积累达到此阈值时，自动冻结窗口并触发 LLM 归并任务。</p>
            </Field>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" className={btnSecondary} onClick={() => setEditingNs(null)}>
                取消
              </button>
              <button type="submit" disabled={editSubmitting} className={btnPrimary}>
                {editSubmitting ? '保存中…' : '保存修改'}
              </button>
            </div>
          </form>
        </Modal>
      )}
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
          <thead className="bg-slate-100/70 text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
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
  const { items: namespaces, error: nsError } = useNamespaces()
  const [pendingProposals, setPendingProposals] = useState<Proposal[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [poolCounts, setPoolCounts] = useState<Record<string, { count: number; totalOccurrences: number }>>({})
  const [selectedNsId, setSelectedNsId] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadData = async () => {
    setLoading(true)
    setError('')
    try {
      // 1. Fetch pending proposals
      const propRes = await api.proposals({ status: 'pending_review' }).catch(() => ({ data: [] }))
      setPendingProposals(propRes.data)

      // 2. Fetch all published tags across namespaces
      const tagRes = await api.tags('').catch(() => ({ data: [] }))
      setTags(tagRes.data)

      // 3. Fetch pool entries count per namespace
      const nsList = await api.namespaces().catch(() => ({ data: [] }))
      const poolMap: Record<string, { count: number; totalOccurrences: number }> = {}
      await Promise.all(
        nsList.data.map(async ns => {
          try {
            const pRes = await api.pool(ns.id)
            const count = pRes.data.length
            const totalOccurrences = pRes.data.reduce((acc, curr) => acc + (curr.occurrenceCount || 1), 0)
            poolMap[ns.id] = { count, totalOccurrences }
          } catch {
            poolMap[ns.id] = { count: 0, totalOccurrences: 0 }
          }
        })
      )
      setPoolCounts(poolMap)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载概览数据失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const namespaceMap = useMemo(() => {
    const map = new Map<string, string>()
    namespaces.forEach(n => map.set(n.id, n.name))
    return map
  }, [namespaces])

  const filteredTags = useMemo(() => {
    if (!selectedNsId) return tags
    return tags.filter(t => t.namespaceId === selectedNsId)
  }, [tags, selectedNsId])

  return (
    <section className="space-y-6">
      <PageHeader
        title="运营概览"
        description="管理标签域、实时统计待审核提案与发布标签的候选池分布。"
        actions={isAdmin ? (
          <NavLink to="/namespaces" className={btnPrimary}>+ 创建标签域</NavLink>
        ) : undefined}
      />

      {(nsError || error) && <Notice message={nsError || error} />}

      {/* 顶部卡片区域：仅保留【标签域】与【待审核】2 个卡片 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* 卡片 1: 标签域 */}
        <div className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider dark:text-slate-400">🌐 标签域数量</span>
            <NavLink to="/namespaces" className="text-xs font-medium text-brand hover:underline">查看与管理 →</NavLink>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-slate-900 dark:text-white tabular-nums">{namespaces.length}</span>
            <span className="text-xs text-slate-500">个独立业务域</span>
          </div>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">按业务隔离标签库规则，自定义自动归并触发阈值。</p>
        </div>

        {/* 卡片 2: 待审核 */}
        <div className={`rounded-xl border p-5 shadow-sm transition-all ${pendingProposals.length > 0 ? 'border-amber-300/80 bg-amber-50/40 dark:border-amber-900/60 dark:bg-amber-950/20' : 'border-slate-200/80 bg-white dark:border-slate-800 dark:bg-slate-900'}`}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-amber-800 uppercase tracking-wider dark:text-amber-300">📋 待审核提案</span>
            {pendingProposals.length > 0 && (
              <NavLink to="/review" className="rounded-full bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-500/20 dark:bg-amber-400/20 dark:text-amber-300">
                进入审核中心处理 ({pendingProposals.length}) →
              </NavLink>
            )}
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-slate-900 dark:text-white tabular-nums">{pendingProposals.length}</span>
            <span className="text-xs text-slate-500">个提案等待人工审核</span>
          </div>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">大模型汇总生成的归并方案须由审核专家批准后发布。</p>
        </div>
      </div>

      {/* 待审核提案快速查看面板 (如有待审核提案) */}
      {pendingProposals.length > 0 && (
        <Panel
          title="⚡ 积压待审核提案 (Awaiting Review)"
          description="系统大模型已完成归并计算，请及时进入审核中心决策发布。"
        >
          <div className="space-y-2.5 pt-1">
            {pendingProposals.slice(0, 5).map(p => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200/70 bg-amber-50/30 p-3 text-xs dark:border-amber-900/40 dark:bg-amber-950/30">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900 dark:text-slate-100">提案 ID: {p.id.slice(0, 8)}…</span>
                    <span className="rounded bg-amber-100 px-2 py-0.5 font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300/50">待审核</span>
                    <span className="text-slate-500">标签域: {namespaceMap.get(p.namespaceId) || p.namespaceId}</span>
                  </div>
                  <div className="text-slate-500 dark:text-slate-400">
                    创建时间: {new Date(p.createdAt).toLocaleString('zh-CN')}
                  </div>
                </div>
                <NavLink to="/review" className={btnPrimary}>
                  开始审核
                </NavLink>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* 正下方：发布标签与候选池按行展示明细面板 */}
      <Panel
        title="🏷️ 发布标签与对应候选池明细"
        description="按行展示每个规范发布标签的所属标签域、涵盖别名及其对应标签域的候选池积压条数与累积频次。"
        actions={
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500 dark:text-slate-400">筛选标签域:</label>
            <select
              className={`${inputClass} w-auto min-w-[140px] py-1 text-xs`}
              value={selectedNsId}
              onChange={e => setSelectedNsId(e.target.value)}
            >
              <option value="">全部标签域 ({namespaces.length})</option>
              {namespaces.map(n => (
                <option key={n.id} value={n.id}>{n.name}</option>
              ))}
            </select>
          </div>
        }
      >
        <TableShell>
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-slate-100/80 dark:bg-slate-800/80 border-b border-slate-200/80 dark:border-slate-800 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4 font-semibold">发布规范标签</th>
                <th className="py-3 px-4 font-semibold">所属标签域</th>
                <th className="py-3 px-4 font-semibold">涵盖别名</th>
                <th className="py-3 px-4 font-semibold">所属域候选池积压</th>
                <th className="py-3 px-4 font-semibold">候选词累积频次</th>
                <th className="py-3 px-4 font-semibold">版本</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-xs text-slate-500">正在加载发布标签与候选池数据…</td>
                </tr>
              ) : filteredTags.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                    {selectedNsId ? '当前所选标签域暂无发布的规范标签。' : '系统中暂无发布的规范标签。可前往「标签库」或「批次导入」管理。'}
                  </td>
                </tr>
              ) : filteredTags.map(tag => {
                const poolInfo = poolCounts[tag.namespaceId] || { count: 0, totalOccurrences: 0 }
                return (
                  <tr key={tag.id} className="transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-800/50">
                    <td className="py-3 px-4">
                      <div className="font-bold text-slate-900 dark:text-slate-100">{tag.canonicalName}</div>
                      {tag.description && <div className="text-[11px] text-slate-500 truncate max-w-[200px]" title={tag.description}>{tag.description}</div>}
                    </td>
                    <td className="py-3 px-4 font-medium text-slate-700 dark:text-slate-300">
                      {namespaceMap.get(tag.namespaceId) || '未知标签域'}
                    </td>
                    <td className="py-3 px-4">
                      {tag.aliases && tag.aliases.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                            {tag.aliases.length} 个别名
                          </span>
                          <span className="text-xs text-slate-500 truncate max-w-[160px]" title={tag.aliases.join('、')}>
                            ({tag.aliases.slice(0, 2).join('、')}{tag.aliases.length > 2 ? '…' : ''})
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">无别名</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center rounded-md px-2.5 py-1 text-xs font-semibold font-mono border ${poolInfo.count > 0 ? 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-900/50' : 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700'}`}>
                        {poolInfo.count} 条待归并
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono text-xs tabular-nums text-slate-600 dark:text-slate-400">
                      {poolInfo.totalOccurrences} 次
                    </td>
                    <td className="py-3 px-4 font-mono text-xs tabular-nums text-slate-500">
                      v{tag.version}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </TableShell>
      </Panel>
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
            <thead className="bg-slate-100/70 text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
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
  const [mode, setMode] = useState<'direct' | 'ai_text'>('direct')
  const [inputTags, setInputTags] = useState('')
  const [eventText, setEventText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [response, setResponse] = useState<TagMatchResponse | null>(null)
  const [aiResponse, setAiResponse] = useState<ExtractAndMatchResponse | null>(null)

  const handleMatch = async (e: FormEvent) => {
    e.preventDefault()
    if (!namespaceId) {
      setError('请先在上方选择标签域')
      return
    }
    setError('')
    setResponse(null)
    setAiResponse(null)
    setBusy(true)

    try {
      if (mode === 'direct') {
        const tags = inputTags.split(/[,，\n]/).map(s => s.trim()).filter(Boolean)
        if (tags.length === 0) {
          setError('请输入至少一个要比对的标签')
          setBusy(false)
          return
        }
        const res = await api.matchTags({ namespaceId, tags, sourceName: 'console_simulator' })
        setResponse(res)
      } else {
        const text = eventText.trim()
        if (!text) {
          setError('请输入事件事情描述大段文本')
          setBusy(false)
          return
        }
        const res = await api.extractAndMatchTag({ namespaceId, text, sourceName: 'console_simulator_aitext' })
        setAiResponse(res)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '请求处理失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel
      title="第三方 API 实时匹配与 AI 事件文本提取测试器"
      actions={
        <div className="flex rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
          <button
            type="button"
            onClick={() => setMode('direct')}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${
              mode === 'direct' ? 'bg-white shadow text-slate-900 dark:bg-slate-700 dark:text-white' : 'text-slate-500 hover:text-slate-900 dark:text-slate-400'
            }`}
          >
            直接标签比对
          </button>
          <button
            type="button"
            onClick={() => setMode('ai_text')}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${
              mode === 'ai_text' ? 'bg-white shadow text-slate-900 dark:bg-slate-700 dark:text-white' : 'text-slate-500 hover:text-slate-900 dark:text-slate-400'
            }`}
          >
            🤖 大模型事件文本提取
          </button>
        </div>
      }
    >
      <form onSubmit={handleMatch} className="space-y-3">
        {mode === 'direct' ? (
          <Field label="输入第三方不规范标签 (逗号或换行分隔)">
            <textarea
              className={`${inputClass} min-h-16 text-xs`}
              placeholder="例如: 自行车与机动车碰撞, 违规空域无人机黑飞"
              value={inputTags}
              onChange={e => setInputTags(e.target.value)}
            />
          </Field>
        ) : (
          <Field label="输入事件/事情大段文本描述 (由大模型提取标签并走候选池流程)">
            <textarea
              className={`${inputClass} min-h-24 text-xs`}
              placeholder="例如：发生在某某主干道路口的电动自行车与机动车擦碰事件，导致交通拥堵，责任认定正在排查中..."
              value={eventText}
              onChange={e => setEventText(e.target.value)}
            />
          </Field>
        )}
        <div className="flex justify-end">
          <button type="submit" disabled={busy || !namespaceId} className={btnPrimary}>
            {busy ? (mode === 'direct' ? '匹配比对中…' : '🤖 AI 抽取标签中…') : mode === 'direct' ? '发起 API 实时匹配测试' : '🤖 提取标签并入池比对'}
          </button>
        </div>
      </form>

      {error && <Notice message={error} />}

      {/* 模式一：直接标签比对返回结果 */}
      {response && (
        <div className="mt-4 space-y-3 border-t border-white/40 dark:border-white/10 pt-3 text-xs">
          <div className="flex items-center gap-3">
            <span className="font-semibold text-slate-700 dark:text-slate-200">API 返回结果:</span>
            <span className="rounded bg-emerald-100/80 px-2 py-0.5 font-semibold text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 tabular-nums">
              命中 ({response.hitCount})
            </span>
            <span className="rounded bg-amber-100/80 px-2 py-0.5 font-semibold text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 tabular-nums">
              未命中/已自动入池 ({response.missCount})
            </span>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            {response.results.map((res, idx) => (
              <div
                key={idx}
                className={`rounded-lg border p-3 ${
                  res.hit ? 'border-emerald-200/80 bg-emerald-50/50 dark:border-emerald-900/60 dark:bg-emerald-950/40' : 'border-amber-200/80 bg-amber-50/50 dark:border-amber-900/60 dark:bg-amber-950/40'
                }`}
              >
                <div className="flex items-center justify-between gap-2 font-medium">
                  <span className="text-slate-900 font-semibold dark:text-slate-100">{res.rawTag}</span>
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
                  <div className="mt-2 space-y-1 text-slate-700 dark:text-slate-300">
                    <p><span className="text-slate-500 dark:text-slate-400">主规范名:</span> <strong className="text-emerald-800 dark:text-emerald-300">{res.canonicalTag.canonicalName}</strong></p>
                    {res.canonicalTag.description && <p className="text-slate-500 line-clamp-1 dark:text-slate-400">{res.canonicalTag.description}</p>}
                  </div>
                )}
                {!res.hit && (
                  <p className="mt-2 text-amber-800 leading-relaxed dark:text-amber-300">{res.message}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 模式二：大模型事件文本提取返回结果 */}
      {aiResponse && (
        <div className="mt-4 space-y-3 border-t border-slate-200 dark:border-slate-800 pt-3 text-xs">
          <div className="rounded-xl border border-brand/30 bg-brand/5 p-4 space-y-2 dark:bg-brand/10">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-900 dark:text-white text-sm">🤖 1. 大模型提取规范标签短语:</span>
              <span className="rounded-full bg-brand/10 px-2.5 py-0.5 font-semibold text-brand text-xs">AI Extraction Completed</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-slate-500">归纳短语:</span>
              <span className="text-base font-extrabold text-brand font-mono">{aiResponse.extractedTag}</span>
            </div>
            {aiResponse.reasoning && (
              <p className="text-slate-600 dark:text-slate-300 text-xs">
                <strong>归纳理由:</strong> {aiResponse.reasoning}
              </p>
            )}
          </div>

          <div className="rounded-xl border p-4 space-y-2 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-900 dark:text-white text-sm">🔄 2. 候选池匹配与自动入池状态:</span>
              {aiResponse.matchResult.hit ? (
                <span className="rounded bg-emerald-600 px-2.5 py-0.5 text-xs text-white font-semibold">
                  HIT 命中 (匹配到已有规范标签)
                </span>
              ) : (
                <span className="rounded bg-amber-600 px-2.5 py-0.5 text-xs text-white font-semibold">
                  MISS 未命中 (已自动收集入候选词池)
                </span>
              )}
            </div>

            {aiResponse.matchResult.hit && aiResponse.matchResult.canonicalTag && (
              <div className="mt-2 rounded-lg bg-emerald-50 border border-emerald-200 p-3 dark:bg-emerald-950/40 dark:border-emerald-900">
                <p className="text-emerald-950 dark:text-emerald-200">
                  成功归并匹配至已有规范标签：<strong>{aiResponse.matchResult.canonicalTag.canonicalName}</strong>（{aiResponse.matchResult.matchedAs === 'alias' ? '命中别名' : '命主标签'}）
                </p>
                {aiResponse.matchResult.canonicalTag.description && (
                  <p className="mt-1 text-slate-600 dark:text-slate-400">{aiResponse.matchResult.canonicalTag.description}</p>
                )}
              </div>
            )}

            {!aiResponse.matchResult.hit && (
              <div className="mt-2 rounded-lg bg-amber-50 border border-amber-200 p-3 dark:bg-amber-950/40 dark:border-amber-900">
                <p className="text-amber-900 font-medium dark:text-amber-300">{aiResponse.matchResult.message}</p>
                <p className="mt-1 text-slate-500">已将 extractedTag「{aiResponse.extractedTag}」入库累计频次。当累计达到标签域阈值时，系统将自动触发大模型批次归并任务。</p>
              </div>
            )}
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
            <StatCard compact title="总计" value={`${result.totalCount} 行`} detail="原始输入标签" />
            <StatCard compact title="已命中" value={`${result.matchedCount} 行`} detail="直接匹配已有规范标签" />
            <StatCard
              compact
              title="进入候选池"
              value={`${result.pooledCount} 次`}
              detail={typeof result.openCandidates === 'number' ? `去重后独立候选词 ${result.openCandidates} 个` : '等待阈值触发'}
            />
            <StatCard
              compact
              title="无效项"
              value={`${result.invalidCount} 行`}
              detail={typeof result.threshold === 'number' ? `触发阈值 ${result.threshold}` : '—'}
            />
          </div>

          {result.pooledCount > 0 && typeof result.openCandidates === 'number' && (
            <div className="rounded-xl border border-blue-200 bg-blue-50/80 p-3.5 text-xs leading-relaxed text-blue-950 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-200">
              💡 <strong>数据统计说明：</strong>本批次共有 <strong>{result.pooledCount} 行</strong>未命中标签分流进入候选池。经规范化<strong>自动去重与词频累加</strong>后，当前标签域中积压的独立未解决候选词条目共有 <strong>{result.openCandidates} 个</strong>（达到阈值时将自动触发大模型批次归并）。
            </div>
          )}
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
              <thead className="bg-slate-100/70 text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
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
                  <thead className="bg-slate-100/70 text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
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
  revertedAliases?: string[]
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
      revertedAliases: [],
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
              <thead className="bg-slate-100/70 text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
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
          readonly={active.status === 'rejected'}
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
  const [showAIPromptModal, setShowAIPromptModal] = useState(false)
  const [aiPrompt, setAiPrompt] = useState<string>(() => {
    return localStorage.getItem('tagmanager_ai_audit_prompt') || ''
  })

  interface AILogEntry {
    time: string
    type: 'info' | 'success' | 'error'
    text: string
  }
  const [aiLogs, setAiLogs] = useState<AILogEntry[]>([])
  const [showAILogModal, setShowAILogModal] = useState(false)

  const appendLog = (type: 'info' | 'success' | 'error', text: string) => {
    const time = new Date().toLocaleTimeString()
    setAiLogs(prev => [...prev, { time, type, text }])
  }

  const [aiStreamText, setAiStreamText] = useState('')

  const handleAIEvaluate = async () => {
    setAiError('')
    setAiEvaluating(true)
    setAiResult(null)
    setAiStreamText('')
    setAiLogs([])
    appendLog('info', `🚀 开始发起 AI 智能助审评估 (提案 ID: ${proposal.id.slice(0, 8)})`)
    appendLog('info', `📥 汇聚提案中 ${tags.length} 项规范标签及其受支撑涵盖候选词快照...`)

    try {
      appendLog('info', `⚡ 建立 SSE 长通道 (text/event-stream) 实时接收流式推理...`)

      let firstChunk = true
      const res = await api.evaluateProposalAIStream(
        proposal.id,
        { config: { prompt: aiPrompt } },
        (chunk, type) => {
          if (type === 'init') {
            appendLog('info', `🟢 SSE 长连接瞬间建立成功 (<1ms)，已保活`)
          } else if (type === 'ping') {
            appendLog('info', `💓 接收 5s 代理保活 Ping，已维持 Nginx 通道活跃`)
          } else if (type === 'chunk' && chunk) {
            setAiStreamText(prev => prev + chunk)
            if (firstChunk) {
              firstChunk = false
              appendLog('info', `✨ 接收到大模型首个 Token，开始实时推导...`)
            }
          }
        }
      )
      setAiResult(res)
      appendLog('success', `✅ AI 助审评估成功！获得 ${res.tagAdvice?.length || 0} 项诊断建议。`)
      appendLog('info', `💡 诊断总结: ${res.overallSummary}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'AI 助审评估请求失败'
      setAiError(msg)
      appendLog('error', `❌ 评估请求失败: ${msg}`)
      setShowAILogModal(true)
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
                onClick={() => batchSetAccepted(visibleTags, false)}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                忽略当前筛选 ({visibleTags.length})
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
                onClick={() => setShowAIPromptModal(true)}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                title="微调当前 AI 助审 System Prompt 诊断规则"
              >
                📜 助审提示词
              </button>
              {aiLogs.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowAILogModal(true)}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 flex items-center gap-1"
                  title="查看 AI 助审执行过程与诊断日志"
                >
                  📋 助审日志 ({aiLogs.length})
                </button>
              )}
            </div>
          )}
        </div>

        {error && <Notice message={error} />}
        {aiError && (
          <div className="flex items-center justify-between rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900">
            <span>{aiError}</span>
            <button
              type="button"
              onClick={() => setShowAILogModal(true)}
              className="font-semibold text-rose-700 hover:underline shrink-0"
            >
              查看诊断日志 ➔
            </button>
          </div>
        )}

        {aiEvaluating && (
          <div className="rounded-xl border border-purple-300 bg-purple-950 p-4 text-xs font-mono text-purple-200 space-y-2.5 shadow-lg">
            <div className="flex items-center justify-between font-bold text-purple-300">
              <span className="flex items-center gap-2">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-purple-400 animate-ping"></span>
                🤖 AI 大模型流式推导诊断中…
              </span>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-purple-400 font-normal">{aiStreamText.length} 字符已生成</span>
                <button
                  type="button"
                  onClick={() => setShowAILogModal(true)}
                  className="rounded border border-purple-800 bg-purple-900/60 px-2 py-0.5 text-[11px] font-normal text-purple-300 hover:bg-purple-800"
                >
                  查看完整排查日志
                </button>
              </div>
            </div>

            <div className="max-h-40 overflow-y-auto whitespace-pre-wrap break-all leading-relaxed text-purple-100 bg-slate-950 p-3 rounded-lg border border-purple-900/50">
              {aiStreamText || '🚀 已建立 SSE 保活长连接，等待大模型返回首个 Token...'}
              <span className="inline-block w-1.5 h-3 bg-purple-400 ml-0.5 animate-pulse"></span>
            </div>
          </div>
        )}

        {aiResult && (
          <div className="rounded-xl border border-purple-200 bg-purple-50/80 p-4 space-y-2 text-xs text-purple-950">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-bold text-purple-900">
                <span>🤖 AI 智能助审二次评估结论</span>
                <span className="rounded bg-purple-200 px-2 py-0.5 text-[11px] font-semibold text-purple-900">
                  {aiResult.tagAdvice.length} 项诊断建议
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowAILogModal(true)}
                  className="rounded border border-purple-300 bg-white px-2.5 py-1 text-xs font-medium text-purple-800 hover:bg-purple-100"
                >
                  📋 查看助审日志
                </button>
                {!readonly && (
                  <button
                    type="button"
                    onClick={handleApplyAISuggestions}
                    className="rounded bg-purple-700 px-3 py-1 text-xs font-semibold text-white hover:bg-purple-800 shadow-sm"
                  >
                    一键应用 AI 智能选牌
                  </button>
                )}
              </div>
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
                const edit = itemEdits[tag.id] ?? {
                  accepted: tag.accepted ?? true,
                  canonicalName: tag.canonicalName || '',
                  description: tag.description || '',
                  aliases: (tag.aliases || []).join(', '),
                  revertedAliases: [],
                }
                const activeAliasList = edit.aliases.split(',').map(s => s.trim()).filter(Boolean)
                const revertedList = edit.revertedAliases || []
                const coveredEntryIds = tag.coveredEntryIds || []
                const advice = adviceMap.get(tag.canonicalName)

                const handleRevertSingle = (aliasToRevert: string) => {
                  const nextActive = activeAliasList.filter(a => a !== aliasToRevert)
                  const nextReverted = Array.from(new Set([...revertedList, aliasToRevert]))
                  const isAutoDiscard = nextActive.length === 0
                  onUpdateItem(tag.id, {
                    accepted: isAutoDiscard ? false : edit.accepted,
                    aliases: nextActive.join(', '),
                    revertedAliases: nextReverted,
                  })
                }

                const handleRestoreSingle = (aliasToRestore: string) => {
                  const nextActive = Array.from(new Set([...activeAliasList, aliasToRestore]))
                  const nextReverted = revertedList.filter(a => a !== aliasToRestore)
                  onUpdateItem(tag.id, {
                    accepted: true,
                    aliases: nextActive.join(', '),
                    revertedAliases: nextReverted,
                  })
                }

                const handleRestoreAll = () => {
                  const nextActive = Array.from(new Set([...activeAliasList, ...revertedList]))
                  onUpdateItem(tag.id, {
                    accepted: true,
                    aliases: nextActive.join(', '),
                    revertedAliases: [],
                  })
                }

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
                      <Field label="描述">
                        <input
                          disabled={!edit.accepted || readonly}
                          className={`${inputClass} py-1.5`}
                          value={edit.description}
                          onChange={e => onUpdateItem(tag.id, { description: e.target.value })}
                        />
                      </Field>
                    </div>

                    {/* Alias Management & Revert Section */}
                    <div className="mt-3 space-y-1.5 rounded-lg border border-slate-200/80 bg-white p-2.5">
                      <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                        <span>新增别名列表 ({activeAliasList.length}):</span>
                        {!readonly && edit.accepted && activeAliasList.length > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              activeAliasList.forEach(a => handleRevertSingle(a))
                            }}
                            className="text-[11px] font-normal text-amber-700 hover:text-amber-900 hover:underline"
                          >
                            ↩️ 一键回退所有别名
                          </button>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 min-h-6">
                        {activeAliasList.length === 0 ? (
                          <span className="text-xs italic text-slate-400">暂无生效别名</span>
                        ) : (
                          activeAliasList.map(alias => (
                            <span
                              key={alias}
                              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-800 shadow-sm"
                            >
                              <span>{alias}</span>
                              {!readonly && (
                                <button
                                  type="button"
                                  onClick={() => handleRevertSingle(alias)}
                                  className="ml-0.5 rounded px-1 py-0.2 text-[11px] font-bold text-amber-700 hover:bg-amber-100 hover:text-amber-900"
                                  title="回退此别名至候选池 (在本提案中不归并)"
                                >
                                  ↩️ 回退
                                </button>
                              )}
                            </span>
                          ))
                        )}
                      </div>

                      {/* Reverted Aliases List */}
                      {revertedList.length > 0 && (
                        <div className="mt-2 rounded-lg bg-amber-50/80 p-2.5 border border-amber-200 text-xs text-amber-950 space-y-1">
                          <div className="flex items-center justify-between font-semibold">
                            <span>↩️ 已回退至候选池别名 ({revertedList.length}):</span>
                            {!readonly && (
                              <button
                                type="button"
                                onClick={handleRestoreAll}
                                className="text-[11px] font-normal text-amber-800 hover:underline"
                              >
                                ↺ 恢复全部别名
                              </button>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {revertedList.map(alias => (
                              <span
                                key={alias}
                                className="inline-flex items-center gap-1 rounded-md bg-amber-100/90 border border-amber-300/80 px-2 py-0.5 text-[11px] text-amber-900 font-medium"
                              >
                                <span className="line-through opacity-70">{alias}</span>
                                {!readonly && (
                                  <button
                                    type="button"
                                    onClick={() => handleRestoreSingle(alias)}
                                    className="ml-0.5 font-bold text-amber-800 hover:text-amber-950 hover:underline"
                                    title="撤销回退，重新恢复此别名"
                                  >
                                    ↺ 恢复
                                  </button>
                                )}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Auto-discard Warning Notice */}
                      {!edit.accepted && revertedList.length > 0 && activeAliasList.length === 0 && (
                        <div className="mt-1.5 rounded-md bg-rose-50 border border-rose-200 p-2 text-[11px] text-rose-800 flex items-center justify-between">
                          <span>⚠️ 该主标签下别名已全部回退至候选池，提交时将自动剔除此主标签。</span>
                          {!readonly && (
                            <button
                              type="button"
                              onClick={handleRestoreAll}
                              className="font-semibold underline shrink-0 hover:text-rose-950"
                            >
                              恢复别名
                            </button>
                          )}
                        </div>
                      )}

                      {!readonly && (
                        <div className="pt-1">
                          <input
                            disabled={!edit.accepted && activeAliasList.length === 0}
                            className={`${inputClass} py-1 text-xs`}
                            placeholder="手动修改或补全别名 (多个用逗号分隔)"
                            value={edit.aliases}
                            onChange={e => onUpdateItem(tag.id, { aliases: e.target.value })}
                          />
                        </div>
                      )}
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
          {proposal.status === 'approved' ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onDecide('approve')}
              className="rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-white hover:bg-brand-dark shadow-sm flex items-center gap-1.5"
            >
              {busy ? '保存中…' : `💾 保存回退修正 (更新已审核提案)`}
            </button>
          ) : (
            <>
              <button type="button" disabled={busy} onClick={() => onDecide('discard')} className={btnWarning}>
                {busy ? '提交中…' : '终止提案'}
              </button>
              <button type="button" disabled={busy} onClick={() => onDecide('reject')} className={btnDanger}>
                {busy ? '提交中…' : '驳回重跑'}
              </button>
              <button type="button" disabled={busy} onClick={() => onDecide('approve')} className={btnSuccess}>
                {busy ? '提交中…' : `批准提交（${acceptedCount}/${proposal.tags.length}）`}
              </button>
            </>
          )}
        </div>
      )}

      {showAIPromptModal && (
        <AIAuditPromptModal
          prompt={aiPrompt}
          onSave={setAiPrompt}
          onClose={() => setShowAIPromptModal(false)}
        />
      )}

      {showAILogModal && (
        <Modal title="📋 AI 助审执行诊断终端" onClose={() => setShowAILogModal(false)}>
          <div className="space-y-3 px-1 py-2 text-xs">
            <div className="flex items-center justify-between text-slate-500">
              <span>共记录 {aiLogs.length} 条执行步骤日志</span>
              <button
                type="button"
                onClick={() => setAiLogs([])}
                className="text-xs text-slate-400 hover:text-slate-600"
              >
                清空日志
              </button>
            </div>

            <div className="max-h-80 overflow-y-auto rounded-xl border border-slate-900 bg-slate-950 p-4 font-mono text-[12px] text-slate-200 leading-relaxed space-y-1.5 shadow-inner">
              {aiLogs.length === 0 ? (
                <div className="text-slate-500 text-center py-4">暂无评估日志</div>
              ) : (
                aiLogs.map((log, idx) => (
                  <div
                    key={idx}
                    className={`flex items-start gap-2 ${
                      log.type === 'error'
                        ? 'text-rose-400 font-semibold'
                        : log.type === 'success'
                        ? 'text-emerald-400 font-semibold'
                        : 'text-slate-300'
                    }`}
                  >
                    <span className="shrink-0 text-slate-500 text-[11px] font-normal">[{log.time}]</span>
                    <span className="whitespace-pre-wrap break-all">{log.text}</span>
                  </div>
                ))
              )}
            </div>

            {aiLogs.some(l => l.text.includes('504') || l.text.includes('Gateway') || l.text.includes('nginx')) && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-3.5 text-xs text-amber-950 space-y-1.5 leading-relaxed">
                <div className="font-bold flex items-center gap-1.5 text-amber-900">
                  <span>⚠️ Nginx 反向代理 60 秒超时排查指引 (504 Gateway Time-out)</span>
                </div>
                <p>
                  检测到您的前端连接经过了 <strong>Nginx 反向代理</strong>，Nginx 默认配置了 <code>proxy_read_timeout 60s;</code>。当后端调用大模型推理超过 60 秒时，Nginx 在前端截断了 HTTP 连接。
                </p>
                <p className="font-semibold text-amber-900">🔧 解决方案（修改 Nginx 配置文件 `nginx.conf`）：</p>
                <div className="rounded-lg bg-slate-900 p-2.5 font-mono text-[11px] text-amber-200 leading-normal">
                  location /api/ &#123;<br/>
                  &nbsp;&nbsp;proxy_pass http://127.0.0.1:8080;<br/>
                  &nbsp;&nbsp;<strong className="text-emerald-400">proxy_read_timeout 600s;</strong>  # 调大为 10 分钟<br/>
                  &nbsp;&nbsp;<strong className="text-emerald-400">proxy_connect_timeout 600s;</strong><br/>
                  &nbsp;&nbsp;<strong className="text-emerald-400">proxy_send_timeout 600s;</strong><br/>
                  &#125;
                </div>
                <p className="text-[11px] text-amber-800">
                  系统已在后端对候选词样本进行精简裁剪，大幅缩短了后续评估生成的耗时！
                </p>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setShowAILogModal(false)}
                className={btnSecondary}
              >
                关闭
              </button>
            </div>
          </div>
        </Modal>
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

  const handleDelete = async (keyId: string, name: string) => {
    if (!window.confirm(`⚠️ 警告：确定要彻底删除 API Key "${name}" 吗？\n\n删除后此 Key 的密钥记录将从数据库完全移除，此操作不可逆！`)) return
    try {
      await api.deleteAPIKey(keyId)
      loadKeys()
    } catch (err) {
      alert(err instanceof Error ? err.message : '删除失败')
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
              <thead className="bg-slate-100/70 text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
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
                    <td className="p-3 text-right space-x-3">
                      {k.status === 'active' && (
                        <button
                          onClick={() => handleRevoke(k.id, k.name)}
                          className="font-medium text-amber-600 hover:underline dark:text-amber-400"
                        >
                          撤销
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(k.id, k.name)}
                        className="font-medium text-rose-600 hover:underline dark:text-rose-400"
                      >
                        删除
                      </button>
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

      {/* 🤖 大模型事件文本提取 API 接入文档 */}
      <Panel title="🤖 AI 事件文本提取与自动入池 API (POST /api/v1/tags/extract-and-match)">
        <div className="space-y-4 text-xs text-slate-700 leading-relaxed dark:text-slate-300">
          <div className="rounded-lg bg-brand/5 border border-brand/20 p-3 space-y-2 dark:bg-brand/10">
            <div className="flex items-center gap-2">
              <span className="rounded bg-brand px-2 py-0.5 text-xs font-bold text-white">POST</span>
              <code className="font-mono text-slate-900 font-semibold dark:text-white">{exampleEndpoint.replace('/tags/match', '/tags/extract-and-match')}</code>
            </div>
            <p className="text-slate-600 dark:text-slate-300">
              用于第三方系统直接传入大段事件/事情描述文本（如工单记录、事故通报长文本）。接口将首先调用大模型提取归纳出标准的规范标签短语，随后无缝进入现有的比对排重与候选池自动收录逻辑。
            </p>
          </div>

          <div className="space-y-2">
            <h4 className="font-semibold text-slate-900 dark:text-slate-100">请求参数 (JSON Body)</h4>
            <div className="rounded-lg bg-slate-50 border p-3 font-mono text-[11px] text-slate-800 dark:bg-slate-950 dark:border-slate-800 dark:text-slate-200">
{`{
  "namespaceId": "YOUR_NAMESPACE_ID", // [必填] 标签域 ID
  "text": "发生在某某干道路口的电动自行车与机动车擦碰事件，导致交通拥堵，责任认定正在排查中...", // [必填] 大段事件描述文本
  "sourceName": "event_log_importer" // [可选] 来源标识
}`}
            </div>
          </div>

          <div className="space-y-2">
            <h4 className="font-semibold text-slate-900 dark:text-slate-100">响应 Schema 结构示例</h4>
            <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 font-mono text-[11px] text-slate-100 leading-relaxed">
{`{
  "namespaceId": "YOUR_NAMESPACE_ID",
  "originalText": "发生在某某干道路口的电动自行车与机动车擦碰事件...",
  "extractedTag": "电动车与机动车擦碰", // AI 从大段文本中提取出的规范标签短语
  "reasoning": "从事件描述中归纳出的关键碰撞特征与交通事由",
  "matchResult": {
    "rawTag": "电动车与机动车擦碰",
    "hit": false, // true 时包含 canonicalTag
    "message": "未匹配到规范标签，已自动收集入候选词池，建议先跳过此数据"
  }
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

function AIAuditPromptModal({
  prompt,
  onSave,
  onClose,
}: {
  prompt: string
  onSave: (p: string) => void
  onClose: () => void
}) {
  const [customPrompt, setCustomPrompt] = useState(prompt || '')
  const defaultPrompt = "你是一名严谨的企业级标签体系审核专家。你的任务是评估大模型自动总结产生的【待审核标签提案】。你需要针对提案中的每一个拟发布规范标签及其别名、受支撑涵盖候选词进行质量诊断与冲突排查，给出现场审核改进建议。请严格按照 JSON Schema 格式返回 JSON 结果。"

  const handleSave = (e: FormEvent) => {
    e.preventDefault()
    localStorage.setItem('tagmanager_ai_audit_prompt', customPrompt)
    onSave(customPrompt)
    onClose()
  }

  return (
    <Modal title="📜 AI 助审提示词规则微调" onClose={onClose}>
      <form onSubmit={handleSave} className="space-y-4 px-1 py-2 text-xs">
        <p className="text-slate-500 leading-relaxed">
          大模型 Endpoint、API Key 与 Model 名称已由【设置中心】全局解算，在此处仅需微调当前审核会话的诊断规则提示词。
        </p>
        <Field label="System Prompt (助审系统提示词)">
          <textarea
            className={`${inputClass} min-h-36 text-xs leading-relaxed`}
            placeholder="定义 AI 助审专家的评估准则"
            value={customPrompt}
            onChange={e => setCustomPrompt(e.target.value)}
          />
          <div className="flex justify-end mt-1">
            <button
              type="button"
              onClick={() => setCustomPrompt(defaultPrompt)}
              className="text-[11px] text-brand hover:underline font-medium"
            >
              恢复为默认提示词
            </button>
          </div>
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className={btnSecondary} onClick={onClose}>取消</button>
          <button type="submit" className={btnPrimary}>保存提示词规则</button>
        </div>
      </form>
    </Modal>
  )
}

function SettingsPage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  // Collapsible card states (Default collapsed)
  const [openAccountCard, setOpenAccountCard] = useState(false)
  const [openLlmCard, setOpenLlmCard] = useState(false)

  // Account password change form state
  const [oldPassword, setOldPassword] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [updatingAccount, setUpdatingAccount] = useState(false)
  const [accountNotice, setAccountNotice] = useState('')
  const [accountError, setAccountError] = useState('')

  // Password visibility toggles
  const [showOldPass, setShowOldPass] = useState(false)
  const [showNewPass, setShowNewPass] = useState(false)
  const [showConfirmPass, setShowConfirmPass] = useState(false)
  const [showConsolidationKey, setShowConsolidationKey] = useState(false)
  const [showAuditKey, setShowAuditKey] = useState(false)

  // LLM Config states
  const [consolidationLlm, setConsolidationLlm] = useState<LLMServiceConfig>({
    baseUrl: '',
    apiKey: '',
    model: '',
    timeoutSeconds: 300,
    maxRetries: 3,
    systemPrompt: '',
  })
  const [auditLlm, setAuditLlm] = useState<LLMServiceConfig>({
    baseUrl: '',
    apiKey: '',
    model: '',
    systemPrompt: '',
  })

  const [fetchingConsolidationModels, setFetchingConsolidationModels] = useState(false)
  const [consolidationModels, setConsolidationModels] = useState<string[]>([])
  const [fetchingAuditModels, setFetchingAuditModels] = useState(false)
  const [auditModels, setAuditModels] = useState<string[]>([])

  const [testingConsolidation, setTestingConsolidation] = useState(false)
  const [consolidationTestRes, setConsolidationTestRes] = useState<{ success: boolean; latencyMs: number; message: string } | null>(null)
  const [testingAudit, setTestingAudit] = useState(false)
  const [auditTestRes, setAuditTestRes] = useState<{ success: boolean; latencyMs: number; message: string } | null>(null)

  const defaultConsolidationPrompt = `你是一名专业数据分析师与标签归纳专家。请对输入的候选词进行聚类、去重与规范化命名，归纳生成标准主标签、描述及别名列表。`
  const defaultAuditPrompt = `你是一名严谨的企业级标签体系审核专家。你的任务是评估大模型自动总结产生的【待审核标签提案】。你需要针对提案中的每一个拟发布规范标签及其别名、受支撑涵盖候选词进行质量诊断与冲突排查，给出现场审核改进建议。请严格按照 JSON Schema 格式返回 JSON 结果。`

  useEffect(() => {
    api.getSettings()
      .then(res => {
        if (res.consolidationLlm) setConsolidationLlm(res.consolidationLlm)
        if (res.auditLlm) setAuditLlm(res.auditLlm)
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const handleFetchModels = async (type: 'consolidation' | 'audit') => {
    setError('')
    setNotice('')
    const cfg = type === 'consolidation' ? consolidationLlm : auditLlm
    if (!cfg.baseUrl || !cfg.apiKey) {
      setError(`请先填写 ${type === 'consolidation' ? '标签归并大模型' : 'AI 助审助手'} 的 Base URL 和 API Key`)
      return
    }
    if (type === 'consolidation') setFetchingConsolidationModels(true)
    else setFetchingAuditModels(true)

    try {
      const res = await api.fetchLLMModels({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey })
      if (type === 'consolidation') {
        setConsolidationModels(res.models)
        setNotice(`成功从 ${cfg.baseUrl}/models 获取到 ${res.models.length} 个可用模型！`)
      } else {
        setAuditModels(res.models)
        setNotice(`成功从 ${cfg.baseUrl}/models 获取到 ${res.models.length} 个可用模型！`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取模型列表失败')
    } finally {
      if (type === 'consolidation') setFetchingConsolidationModels(false)
      else setFetchingAuditModels(false)
    }
  }

  const handleTestConnection = async (type: 'consolidation' | 'audit') => {
    setError('')
    setNotice('')
    const cfg = type === 'consolidation' ? consolidationLlm : auditLlm
    if (!cfg.baseUrl || !cfg.apiKey || !cfg.model) {
      setError(`请填写完整 ${type === 'consolidation' ? '标签归并大模型' : 'AI 助审助手'} 的 Base URL、API Key 与 Model 名称`)
      return
    }
    if (type === 'consolidation') setTestingConsolidation(true)
    else setTestingAudit(true)

    try {
      const res = await api.testLLM({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model })
      if (type === 'consolidation') setConsolidationTestRes(res)
      else setAuditTestRes(res)
    } catch (err) {
      const failRes = { success: false, latencyMs: 0, message: err instanceof Error ? err.message : '测试失败' }
      if (type === 'consolidation') setConsolidationTestRes(failRes)
      else setAuditTestRes(failRes)
    } finally {
      if (type === 'consolidation') setTestingConsolidation(false)
      else setTestingAudit(false)
    }
  }

  const handleAccountPasswordSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setAccountNotice('')
    setAccountError('')
    if (!oldPassword) {
      setAccountError('请输入当前旧密码以验证身份')
      return
    }
    if (!newPassword) {
      setAccountError('请输入新密码')
      return
    }
    if (newPassword.length < 6) {
      setAccountError('新密码长度不少于 6 位字符')
      return
    }
    if (newPassword !== confirmPassword) {
      setAccountError('两次输入的新密码不一致，请重新核对')
      return
    }

    setUpdatingAccount(true)
    try {
      await api.changePassword({ oldPassword, newPassword })
      setOldPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setAccountNotice('账号登录密码已成功修改！后续登录请使用新密码。')
    } catch (err) {
      setAccountError(err instanceof Error ? err.message : '修改账号密码失败')
    } finally {
      setUpdatingAccount(false)
    }
  }

  const handleSave = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setNotice('')
    setError('')
    try {
      await api.updateSettings({ consolidationLlm, auditLlm })
      setNotice('大模型配置保存成功！后端 API 与 Worker 将在线同步动态感知加载最新数据库配置。')
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存大模型配置失败')
    } finally {
      setSaving(false)
    }
  }

  // Common Soft Blue Input Style: Light Grey default, Soft Blue focus/filled
  const settingInputClass =
    'w-full min-w-0 rounded-xl border border-slate-200/80 bg-slate-100/80 px-3.5 py-2.5 text-sm text-slate-900 outline-none transition-all duration-150 focus:border-brand focus:bg-[#EDF4FF] focus:ring-2 focus:ring-brand/20 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-brand dark:focus:bg-brand/20 dark:focus:ring-brand/30'

  if (loading) return <div className="p-8 text-center text-sm font-medium text-slate-500 dark:text-slate-400">正在载入系统设置中心…</div>

  return (
    <div className="space-y-6">
      <PageHeader
        title="设置中心"
        description="图形化管理【账号安全】、【标签归并大模型引擎】与【AI 智能助审助手】。配置优先写入数据库并发在线无缝生效。"
      />

      {notice && <Notice message={notice} />}
      {error && <Notice message={error} />}

      {/* Stacked Cards Section (自上而下自适应独立卡片堆叠) */}
      <div className="space-y-5">
        {/* Card 1: 账号安全与密码设置 */}
        <section className="rounded-2xl border border-slate-200/80 bg-white shadow-sm transition-all duration-200 dark:border-slate-800/80 dark:bg-slate-900">
          {/* Card Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800/80">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setOpenAccountCard(!openAccountCard)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                title={openAccountCard ? '收起卡片' : '展开卡片'}
              >
                <span className={`text-xs transition-transform duration-200 ${openAccountCard ? 'rotate-0' : '-rotate-90'}`}>▼</span>
              </button>
              <div className="min-w-0">
                <h2 className="text-base font-extrabold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
                  账号安全与密码设置
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">安全控制</span>
                </h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 truncate">
                  当前登录账号：<span className="font-semibold text-slate-700 dark:text-slate-200">admin@example.com</span> · 角色：<span className="font-mono text-brand">admin</span>
                </p>
              </div>
            </div>
            {/* Right Circle Icon */}
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-base text-slate-600 dark:bg-slate-800 dark:text-slate-300 shadow-sm">
              👤
            </div>
          </div>

          {/* Card Body */}
          {openAccountCard && (
            <div className="p-6 space-y-5">
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed border-b border-slate-100 pb-3 dark:border-slate-800/60">
                为了保证您的系统运维与标签治理账号安全，建议定期更新登录密码。密码长度不少于 6 个字符。
              </p>

              {accountNotice && <SuccessNotice message={accountNotice} />}
              {accountError && <Notice message={accountError} />}

              <form onSubmit={handleAccountPasswordSubmit} className="space-y-5">
                {/* 2x2 Grid Form Layout */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 sm:gap-6">
                  {/* Cell 1: 新登录用户名/邮箱 */}
                  <div className="min-w-0 space-y-1">
                    <label className="block text-xs font-bold text-slate-900 dark:text-slate-100">新登录用户名 / 邮箱</label>
                    <p className="text-[11px] text-slate-400 dark:text-slate-500">可选：如需更名（默认显示当前登录邮箱）</p>
                    <input
                      type="text"
                      className={settingInputClass}
                      placeholder="admin@example.com"
                      value={newEmail}
                      onChange={e => setNewEmail(e.target.value)}
                    />
                  </div>

                  {/* Cell 2: 当前旧密码 */}
                  <div className="min-w-0 space-y-1">
                    <label className="block text-xs font-bold text-slate-900 dark:text-slate-100">当前旧密码</label>
                    <p className="text-[11px] text-slate-400 dark:text-slate-500">验证当前管理员凭证后方可更新</p>
                    <div className="relative">
                      <input
                        type={showOldPass ? 'text' : 'password'}
                        required
                        className={`${settingInputClass} pr-10`}
                        placeholder="输入当前使用的旧密码"
                        value={oldPassword}
                        onChange={e => setOldPassword(e.target.value)}
                      />
                      <button
                        type="button"
                        onClick={() => setShowOldPass(!showOldPass)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                        title={showOldPass ? '隐藏密码' : '显示密码'}
                      >
                        {showOldPass ? '🙈' : '👁️'}
                      </button>
                    </div>
                  </div>

                  {/* Cell 3: 设置新密码 */}
                  <div className="min-w-0 space-y-1">
                    <label className="block text-xs font-bold text-slate-900 dark:text-slate-100">设置新密码</label>
                    <p className="text-[11px] text-slate-400 dark:text-slate-500">不少于 6 位字符，建议结合字母与数字</p>
                    <div className="relative">
                      <input
                        type={showNewPass ? 'text' : 'password'}
                        required
                        className={`${settingInputClass} pr-10`}
                        placeholder="请输入新密码"
                        value={newPassword}
                        onChange={e => setNewPassword(e.target.value)}
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewPass(!showNewPass)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                        title={showNewPass ? '隐藏密码' : '显示密码'}
                      >
                        {showNewPass ? '🙈' : '👁️'}
                      </button>
                    </div>
                  </div>

                  {/* Cell 4: 确认新密码 */}
                  <div className="min-w-0 space-y-1">
                    <label className="block text-xs font-bold text-slate-900 dark:text-slate-100">确认新密码</label>
                    <p className="text-[11px] text-slate-400 dark:text-slate-500">再次输入新密码进行确认</p>
                    <div className="relative">
                      <input
                        type={showConfirmPass ? 'text' : 'password'}
                        required
                        className={`${settingInputClass} pr-10`}
                        placeholder="请再次确认新密码"
                        value={confirmPassword}
                        onChange={e => setConfirmPassword(e.target.value)}
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPass(!showConfirmPass)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                        title={showConfirmPass ? '隐藏密码' : '显示密码'}
                      >
                        {showConfirmPass ? '🙈' : '👁️'}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Bottom Right Actions */}
                <div className="flex justify-end pt-2">
                  <button
                    type="submit"
                    disabled={updatingAccount}
                    className="inline-flex items-center gap-1.5 rounded-full bg-brand px-5 py-2.5 text-xs sm:text-sm font-semibold text-white shadow-xs shadow-brand/25 hover:bg-brand-dark transition-all duration-150 active:scale-[0.98] disabled:opacity-50 cursor-pointer"
                  >
                    <span>🔑</span>
                    <span>{updatingAccount ? '修改中…' : '修改账号密码'}</span>
                  </button>
                </div>
              </form>
            </div>
          )}
        </section>

        {/* Card 2: 大模型与 AI 助审服务配置 (Consolidated LLM & AI Audit Copilot Card) */}
        <section className="rounded-2xl border border-slate-200/80 bg-white shadow-sm transition-all duration-200 dark:border-slate-800/80 dark:bg-slate-900">
          {/* Parent Card Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800/80">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setOpenLlmCard(!openLlmCard)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                title={openLlmCard ? '收起卡片' : '展开卡片'}
              >
                <span className={`text-xs transition-transform duration-200 ${openLlmCard ? 'rotate-0' : '-rotate-90'}`}>▼</span>
              </button>
              <div className="min-w-0">
                <h2 className="text-base font-extrabold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
                  大模型与 AI 助审服务配置
                  <span className="rounded-full bg-brand/10 px-2.5 py-0.5 text-[11px] font-semibold text-brand">核心 AI 引擎</span>
                </h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 truncate">
                  包含【1. 标签归并大模型引擎】与【2. AI 智能助审助手】的 LLM Endpoint、密钥与 Prompt 配置
                </p>
              </div>
            </div>
            {/* Right Circle Icon */}
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-base text-brand dark:bg-brand/20 shadow-sm">
              🤖
            </div>
          </div>

          {/* Parent Card Body (Displays Sub-section 1 & Sub-section 2 when expanded) */}
          {openLlmCard && (
            <div className="p-6 space-y-8">
              {/* Sub-section 1: 1. 标签归并大模型配置 */}
              <div className="space-y-5">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800/60">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-bold text-slate-900 dark:text-slate-100">1. 标签归并大模型配置 (Tag Consolidation LLM)</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">归并引擎</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleTestConnection('consolidation')}
                    disabled={testingConsolidation}
                    className="shrink-0 rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 transition-colors cursor-pointer"
                  >
                    {testingConsolidation ? '测试中…' : '⚡ 测试连接'}
                  </button>
                </div>

                {consolidationTestRes && (
                  <div className={`rounded-xl border p-3.5 text-xs ${consolidationTestRes.success ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-rose-200 bg-rose-50 text-rose-900'}`}>
                    <div className="font-semibold">{consolidationTestRes.success ? '✅ 归并引擎测试连接成功' : '❌ 归并引擎测试连接失败'}</div>
                    <p className="mt-0.5 leading-relaxed">{consolidationTestRes.message}</p>
                  </div>
                )}

                {/* 2x2 Grid Form for Consolidation LLM */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 sm:gap-6">
                  {/* Cell 1: Base URL */}
                  <div className="min-w-0 space-y-1">
                    <label className="block text-xs font-bold text-slate-900 dark:text-slate-100">Base URL (OpenAI 兼容 Endpoint)</label>
                    <p className="text-[11px] text-slate-400 dark:text-slate-500">模型 API 服务根地址，通常包含 /v1</p>
                    <input
                      className={settingInputClass}
                      placeholder="例如：https://api.openai.com/v1 或 https://api.deepseek.com/v1"
                      value={consolidationLlm.baseUrl}
                      onChange={e => setConsolidationLlm({ ...consolidationLlm, baseUrl: e.target.value })}
                    />
                  </div>

                  {/* Cell 2: API Key */}
                  <div className="min-w-0 space-y-1">
                    <label className="block text-xs font-bold text-slate-900 dark:text-slate-100">API Key 访问凭证</label>
                    <p className="text-[11px] text-slate-400 dark:text-slate-500">仅存于后端加密节点，绝对不透传至浏览器</p>
                    <div className="relative">
                      <input
                        type={showConsolidationKey ? 'text' : 'password'}
                        className={`${settingInputClass} pr-10`}
                        placeholder="sk-..."
                        value={consolidationLlm.apiKey}
                        onChange={e => setConsolidationLlm({ ...consolidationLlm, apiKey: e.target.value })}
                      />
                      <button
                        type="button"
                        onClick={() => setShowConsolidationKey(!showConsolidationKey)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                        title={showConsolidationKey ? '隐藏 API Key' : '显示 API Key'}
                      >
                        {showConsolidationKey ? '🙈' : '👁️'}
                      </button>
                    </div>
                  </div>

                  {/* Cell 3: Model Name */}
                  <div className="min-w-0 space-y-1 sm:col-span-2 lg:col-span-1">
                    <label className="block text-xs font-bold text-slate-900 dark:text-slate-100">Model Name (模型名称)</label>
                    <p className="text-[11px] text-slate-400 dark:text-slate-500">手动填写或点击在线获取可用模型名称</p>
                    <div className="flex items-center gap-2">
                      <input
                        className={`${settingInputClass} font-mono`}
                        placeholder="如 gpt-4o-mini 或 deepseek-chat"
                        value={consolidationLlm.model}
                        onChange={e => setConsolidationLlm({ ...consolidationLlm, model: e.target.value })}
                      />
                      <button
                        type="button"
                        onClick={() => handleFetchModels('consolidation')}
                        disabled={fetchingConsolidationModels}
                        className="shrink-0 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                      >
                        {fetchingConsolidationModels ? '拉取中…' : '🔄 获取列表'}
                      </button>
                    </div>
                    {consolidationModels.length > 0 && (
                      <div className="mt-2 flex items-center gap-2 text-xs">
                        <span className="text-slate-500 font-medium shrink-0">下拉选择:</span>
                        <select
                          value={consolidationLlm.model}
                          onChange={e => setConsolidationLlm({ ...consolidationLlm, model: e.target.value })}
                          className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 outline-none"
                        >
                          <option value="">-- 请选择在线拉取的模型 --</option>
                          {consolidationModels.map(m => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>

                  {/* Cell 4: 超时与重试 */}
                  <div className="grid grid-cols-2 gap-3 min-w-0">
                    <div className="space-y-1">
                      <label className="block text-xs font-bold text-slate-900 dark:text-slate-100">单次超时 (秒)</label>
                      <p className="text-[11px] text-slate-400 dark:text-slate-500">范围 10 - 1800 秒（推荐 600s 以上）</p>
                      <input
                        type="number"
                        min="10"
                        max="1800"
                        className={settingInputClass}
                        value={consolidationLlm.timeoutSeconds ?? 600}
                        onChange={e => setConsolidationLlm({ ...consolidationLlm, timeoutSeconds: parseInt(e.target.value, 10) || 600 })}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-xs font-bold text-slate-900 dark:text-slate-100">最大重试上限</label>
                      <p className="text-[11px] text-slate-400 dark:text-slate-500">范围 1 - 10 次</p>
                      <input
                        type="number"
                        min="1"
                        max="10"
                        className={settingInputClass}
                        value={consolidationLlm.maxRetries ?? 3}
                        onChange={e => setConsolidationLlm({ ...consolidationLlm, maxRetries: parseInt(e.target.value, 10) || 3 })}
                      />
                    </div>
                  </div>

                  {/* Cell 5: System Prompt */}
                  <div className="min-w-0 space-y-1 sm:col-span-2">
                    <label className="block text-xs font-bold text-slate-900 dark:text-slate-100">标签归并 System Prompt (系统提示词)</label>
                    <p className="text-[11px] text-slate-400 dark:text-slate-500">定义大模型的归并泛化逻辑与约束规则</p>
                    <textarea
                      className={`${settingInputClass} min-h-24 leading-relaxed font-mono text-xs`}
                      placeholder="请输入归并 System Prompt"
                      value={consolidationLlm.systemPrompt || ''}
                      onChange={e => setConsolidationLlm({ ...consolidationLlm, systemPrompt: e.target.value })}
                    />
                    <div className="flex justify-end pt-1">
                      <button
                        type="button"
                        onClick={() => setConsolidationLlm({ ...consolidationLlm, systemPrompt: defaultConsolidationPrompt })}
                        className="text-xs text-brand hover:underline font-semibold"
                      >
                        ↺ 重置为默认归并提示词
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Sub-section Separator */}
              <div className="border-t border-slate-100 dark:border-slate-800/80 my-2" />

              {/* Sub-section 2: 2. AI 智能助审助手配置 */}
              <div className="space-y-5">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800/60">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-bold text-slate-900 dark:text-slate-100">2. AI 智能助审助手配置 (AI Audit Copilot LLM)</span>
                    <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-semibold text-purple-800 dark:bg-purple-950/80 dark:text-purple-300">助审 Copilot</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleTestConnection('audit')}
                    disabled={testingAudit}
                    className="shrink-0 rounded-full border border-purple-300 bg-purple-50 px-3 py-1 text-xs font-semibold text-purple-800 hover:bg-purple-100 transition-colors cursor-pointer"
                  >
                    {testingAudit ? '测试中…' : '⚡ 测试连接'}
                  </button>
                </div>

                {auditTestRes && (
                  <div className={`rounded-xl border p-3.5 text-xs ${auditTestRes.success ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-rose-200 bg-rose-50 text-rose-900'}`}>
                    <div className="font-semibold">{auditTestRes.success ? '✅ 助审助手测试连接成功' : '❌ 助审助手测试连接失败'}</div>
                    <p className="mt-0.5 leading-relaxed">{auditTestRes.message}</p>
                  </div>
                )}

                {/* 2x2 Grid Form for Audit Copilot LLM */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 sm:gap-6">
                  {/* Cell 1: Base URL */}
                  <div className="min-w-0 space-y-1">
                    <label className="block text-xs font-bold text-slate-900 dark:text-slate-100">Base URL (OpenAI 兼容 Endpoint)</label>
                    <p className="text-[11px] text-slate-400 dark:text-slate-500">模型 API 服务根地址，通常包含 /v1</p>
                    <input
                      className={settingInputClass}
                      placeholder="例如：https://api.openai.com/v1"
                      value={auditLlm.baseUrl}
                      onChange={e => setAuditLlm({ ...auditLlm, baseUrl: e.target.value })}
                    />
                  </div>

                  {/* Cell 2: API Key */}
                  <div className="min-w-0 space-y-1">
                    <label className="block text-xs font-bold text-slate-900 dark:text-slate-100">API Key 访问凭证</label>
                    <p className="text-[11px] text-slate-400 dark:text-slate-500">仅存于后端加密节点，绝对不透传至浏览器</p>
                    <div className="relative">
                      <input
                        type={showAuditKey ? 'text' : 'password'}
                        className={`${settingInputClass} pr-10`}
                        placeholder="sk-..."
                        value={auditLlm.apiKey}
                        onChange={e => setAuditLlm({ ...auditLlm, apiKey: e.target.value })}
                      />
                      <button
                        type="button"
                        onClick={() => setShowAuditKey(!showAuditKey)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                        title={showAuditKey ? '隐藏 API Key' : '显示 API Key'}
                      >
                        {showAuditKey ? '🙈' : '👁️'}
                      </button>
                    </div>
                  </div>

                  {/* Cell 3: Model Name */}
                  <div className="min-w-0 space-y-1 sm:col-span-2 lg:col-span-1">
                    <label className="block text-xs font-bold text-slate-900 dark:text-slate-100">Model Name (模型名称)</label>
                    <p className="text-[11px] text-slate-400 dark:text-slate-500">手动填写或点击在线获取可用模型名称</p>
                    <div className="flex items-center gap-2">
                      <input
                        className={`${settingInputClass} font-mono`}
                        placeholder="如 gpt-4o-mini 或 deepseek-chat"
                        value={auditLlm.model}
                        onChange={e => setAuditLlm({ ...auditLlm, model: e.target.value })}
                      />
                      <button
                        type="button"
                        onClick={() => handleFetchModels('audit')}
                        disabled={fetchingAuditModels}
                        className="shrink-0 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                      >
                        {fetchingAuditModels ? '拉取中…' : '🔄 获取列表'}
                      </button>
                    </div>
                    {auditModels.length > 0 && (
                      <div className="mt-2 flex items-center gap-2 text-xs">
                        <span className="text-slate-500 font-medium shrink-0">下拉选择:</span>
                        <select
                          value={auditLlm.model}
                          onChange={e => setAuditLlm({ ...auditLlm, model: e.target.value })}
                          className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 outline-none"
                        >
                          <option value="">-- 请选择在线拉取的模型 --</option>
                          {auditModels.map(m => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>

                  {/* Cell 4: 超时与重试 */}
                  <div className="grid grid-cols-2 gap-3 min-w-0">
                    <div className="space-y-1">
                      <label className="block text-xs font-bold text-slate-900 dark:text-slate-100">单次超时 (秒)</label>
                      <p className="text-[11px] text-slate-400 dark:text-slate-500">范围 10 - 1800 秒</p>
                      <input
                        type="number"
                        min="10"
                        max="1800"
                        className={settingInputClass}
                        value={auditLlm.timeoutSeconds ?? 300}
                        onChange={e => setAuditLlm({ ...auditLlm, timeoutSeconds: parseInt(e.target.value, 10) || 300 })}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-xs font-bold text-slate-900 dark:text-slate-100">最大重试上限</label>
                      <p className="text-[11px] text-slate-400 dark:text-slate-500">范围 1 - 10 次</p>
                      <input
                        type="number"
                        min="1"
                        max="10"
                        className={settingInputClass}
                        value={auditLlm.maxRetries ?? 3}
                        onChange={e => setAuditLlm({ ...auditLlm, maxRetries: parseInt(e.target.value, 10) || 3 })}
                      />
                    </div>
                  </div>

                  {/* Cell 5: System Prompt */}
                  <div className="min-w-0 space-y-1 sm:col-span-2">
                    <label className="block text-xs font-bold text-slate-900 dark:text-slate-100">助审系统 Prompt (系统的提示词)</label>
                    <p className="text-[11px] text-slate-400 dark:text-slate-500">定义助审大模型的质量诊断与质量打分范式</p>
                    <textarea
                      className={`${settingInputClass} min-h-24 leading-relaxed font-mono text-xs`}
                      placeholder="请输入助审 System Prompt"
                      value={auditLlm.systemPrompt || ''}
                      onChange={e => setAuditLlm({ ...auditLlm, systemPrompt: e.target.value })}
                    />
                    <div className="flex justify-end pt-1">
                      <button
                        type="button"
                        onClick={() => setAuditLlm({ ...auditLlm, systemPrompt: defaultAuditPrompt })}
                        className="text-xs text-brand hover:underline font-semibold"
                      >
                        ↺ 重置为默认助审提示词
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Bottom Right Actions Inside Consolidated LLM Card */}
              <div className="flex justify-end pt-4 border-t border-slate-100 dark:border-slate-800/80">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 rounded-full bg-brand px-6 py-2.5 text-xs sm:text-sm font-bold text-white shadow-xs shadow-brand/25 hover:bg-brand-dark transition-all duration-150 active:scale-[0.98] disabled:opacity-50 cursor-pointer"
                >
                  <span>💾</span>
                  <span>{saving ? '保存中…' : '保存所有大模型配置'}</span>
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
