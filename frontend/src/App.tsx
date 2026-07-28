import { FormEvent, useEffect, useMemo, useState } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { api } from './lib/api'
import type { ImportResult, Namespace, PoolEntry, Proposal, Role, Tag, User } from './types/api'
import {
  EmptyState,
  Field,
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
  inputClass,
} from './components/ui'

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
                  <td className="max-w-[200px] truncate p-3 text-slate-600" title={tag.aliases.join('、') || undefined}>
                    {tag.aliases.join('、') || '—'}
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
    </section>
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

function PoolPage({ canTrigger }: { canTrigger: boolean }) {
  const { items: namespaces } = useNamespaces()
  const [namespaceId, setNamespaceId] = useState('')
  const [items, setItems] = useState<PoolEntry[]>([])
  const [threshold, setThreshold] = useState(0)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [triggering, setTriggering] = useState(false)

  const reload = (id: string) => {
    api.pool(id).then(x => { setItems(x.data); setThreshold(x.threshold) }).catch(err => setError(err instanceof Error ? err.message : '加载候选池失败'))
  }
  useEffect(() => {
    setError('')
    setMessage('')
    if (namespaceId) reload(namespaceId)
    else { setItems([]); setThreshold(0) }
  }, [namespaceId])

  const progress = useMemo(() => threshold ? Math.min(100, Math.round(items.length / threshold * 100)) : 0, [items, threshold])

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
      reload(namespaceId)
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
                    <td className="hidden p-3 text-slate-500 md:table-cell">{new Date(item.lastSeenAt).toLocaleString()}</td>
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
        </div>
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

function ReviewPage() {
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [comments, setComments] = useState<Record<string, string>>({})
  const [itemEdits, setItemEdits] = useState<Record<string, Record<string, ItemEditState>>>({})

  const reload = () => {
    void api.proposals().then(x => {
      setProposals(x.data)
      const initial: Record<string, Record<string, ItemEditState>> = {}
      for (const prop of x.data) {
        initial[prop.id] = {}
        for (const tag of prop.tags) {
          initial[prop.id][tag.id] = {
            accepted: true,
            canonicalName: tag.canonicalName,
            description: tag.description,
            aliases: tag.aliases.join(', '),
          }
        }
      }
      setItemEdits(initial)
    }).catch(e => setError(e.message))
  }

  useEffect(() => { reload() }, [])

  const updateItem = (proposalId: string, tagId: string, patch: Partial<ItemEditState>) => {
    setItemEdits(prev => ({
      ...prev,
      [proposalId]: {
        ...prev[proposalId],
        [tagId]: { ...prev[proposalId]?.[tagId], ...patch } as ItemEditState,
      },
    }))
  }

  async function decide(proposal: Proposal, approve: boolean) {
    setBusy(proposal.id)
    setError('')
    try {
      const tagPayloads = proposal.tags.map(t => {
        const edit = itemEdits[proposal.id]?.[t.id]
        return {
          proposalTagId: t.id,
          accepted: edit ? edit.accepted : true,
          canonicalName: edit ? edit.canonicalName.trim() : t.canonicalName,
          description: edit ? edit.description.trim() : t.description,
          aliases: edit ? edit.aliases.split(',').map(s => s.trim()).filter(Boolean) : t.aliases,
        }
      })

      await api.decideProposal(proposal.id, {
        approve,
        version: proposal.version,
        comments: comments[proposal.id] ?? '',
        tags: tagPayloads,
      })
      reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : '审核提交失败')
    } finally {
      setBusy('')
    }
  }

  return (
    <section className="space-y-5">
      <PageHeader
        title="审核中心"
        description="逐项采纳或忽略模型建议，可编辑规范名与别名。批准后写入标签库；驳回将带反馈重跑模型。"
      />
      {error && <Notice message={error} />}

      <div className="space-y-5">
        {proposals.map(proposal => {
          const edits = itemEdits[proposal.id] ?? {}
          const acceptedCount = proposal.tags.filter(t => (edits[t.id]?.accepted ?? true)).length
          const readonly = proposal.status !== 'pending_review' && proposal.status !== 'pending'

          return (
            <article key={proposal.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-4 sm:px-5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-ink">提案 {proposal.id.slice(0, 8)}</p>
                    <StatusBadge status={proposal.status} />
                  </div>
                  <p className="mt-1 text-xs text-slate-500 sm:text-sm">
                    {new Date(proposal.createdAt).toLocaleString()}
                    {' · '}v{proposal.version}
                    {' · '}
                    <span className="tabular-nums">{proposal.tags.length}</span> 项建议
                    {' · '}
                    已采纳 <span className="tabular-nums font-medium text-emerald-700">{acceptedCount}</span>
                  </p>
                </div>
              </div>

              <div className={`px-4 py-4 sm:px-5 ${readonly ? 'pointer-events-none opacity-60' : ''}`}>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">模型建议</h3>
                <div className="grid gap-3 xl:grid-cols-2">
                  {proposal.tags.map(tag => {
                    const edit = edits[tag.id] ?? {
                      accepted: true,
                      canonicalName: tag.canonicalName,
                      description: tag.description,
                      aliases: tag.aliases.join(', '),
                    }
                    return (
                      <div
                        key={tag.id}
                        className={`min-w-0 rounded-xl border p-3 sm:p-4 ${
                          edit.accepted
                            ? 'border-slate-200 bg-slate-50/40'
                            : 'border-red-200 bg-red-50/40'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="inline-flex overflow-hidden rounded-lg border border-slate-200 bg-white text-xs font-semibold">
                            <button
                              type="button"
                              title="Accept"
                              onClick={() => updateItem(proposal.id, tag.id, { accepted: true })}
                              className={`px-2.5 py-1 ${edit.accepted ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
                            >
                              采纳
                            </button>
                            <button
                              type="button"
                              title="Reject item"
                              onClick={() => updateItem(proposal.id, tag.id, { accepted: false })}
                              className={`px-2.5 py-1 ${!edit.accepted ? 'bg-slate-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
                            >
                              忽略
                            </button>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-slate-500">
                            <span className="rounded bg-brand/10 px-2 py-0.5 font-semibold text-brand tabular-nums">
                              {Math.round(tag.confidence * 100)}%
                            </span>
                            <span className="tabular-nums">覆盖 {tag.coveredEntryIds.length}</span>
                          </div>
                        </div>

                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          <Field label="规范名">
                            <input
                              disabled={!edit.accepted || readonly}
                              className={`${inputClass} py-1.5 font-medium`}
                              value={edit.canonicalName}
                              onChange={e => updateItem(proposal.id, tag.id, { canonicalName: e.target.value })}
                            />
                          </Field>
                          <Field label="别名">
                            <input
                              disabled={!edit.accepted || readonly}
                              className={`${inputClass} py-1.5`}
                              placeholder="逗号分隔"
                              value={edit.aliases}
                              onChange={e => updateItem(proposal.id, tag.id, { aliases: e.target.value })}
                            />
                          </Field>
                          <Field label="描述" className="sm:col-span-2">
                            <input
                              disabled={!edit.accepted || readonly}
                              className={`${inputClass} py-1.5`}
                              value={edit.description}
                              onChange={e => updateItem(proposal.id, tag.id, { description: e.target.value })}
                            />
                          </Field>
                        </div>
                        {tag.rationale && (
                          <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-slate-500" title={tag.rationale}>
                            理由：{tag.rationale}
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>

                <div className="mt-4">
                  <Field label="审核意见 / 驳回反馈">
                    <textarea
                      disabled={readonly}
                      className={`${inputClass} min-h-20`}
                      placeholder="驳回时填写给模型的反馈，例如：请勿将开发与运营合并"
                      value={comments[proposal.id] ?? ''}
                      onChange={e => setComments({ ...comments, [proposal.id]: e.target.value })}
                    />
                  </Field>
                </div>
              </div>

              {!readonly && (
                <div className="sticky bottom-0 flex flex-col-reverse gap-2 border-t border-slate-100 bg-white/95 px-4 py-3 backdrop-blur sm:flex-row sm:justify-end sm:px-5">
                  <button
                    disabled={busy === proposal.id}
                    onClick={() => decide(proposal, false)}
                    className={btnDanger}
                  >
                    {busy === proposal.id ? '提交中…' : '驳回重跑'}
                  </button>
                  <button
                    disabled={busy === proposal.id}
                    onClick={() => decide(proposal, true)}
                    className={btnSuccess}
                  >
                    {busy === proposal.id ? '提交中…' : `批准提交（${acceptedCount}/${proposal.tags.length}）`}
                  </button>
                </div>
              )}
            </article>
          )
        })}

        {proposals.length === 0 && (
          <EmptyState
            title="暂无待审核提案"
            description="候选池达到阈值、worker 成功调用模型后，提案会出现在这里。"
          />
        )}
      </div>
    </section>
  )
}
