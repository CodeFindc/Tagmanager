import { FormEvent, useEffect, useMemo, useState } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { api } from './lib/api'
import type { ImportResult, Namespace, PoolEntry, Proposal, Role, Tag, User } from './types/api'

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
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4">
          <div>
            <p className="text-lg font-bold text-ink">Tag Manager</p>
            <p className="text-xs text-slate-500">LLM 辅助的可审核标签库</p>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <div className="text-right">
              <p className="font-medium">{user.email} <span className="ml-1 text-xs rounded bg-slate-100 px-1.5 py-0.5 text-slate-600 font-mono">{user.role}</span></p>
            </div>
            <button className="text-xs text-slate-600 hover:text-slate-900 border rounded px-2 py-1" onClick={() => setShowPasswordModal(true)}>
              修改密码
            </button>
            <button className="text-sm text-brand font-medium" onClick={() => { localStorage.removeItem('tagmanager-token'); setUser(null) }}>
              退出
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-6 px-5 py-6 md:grid-cols-[190px_1fr]">
        <nav className="flex gap-2 overflow-auto md:flex-col">
          {menu.map(([to, label]) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `rounded-lg px-3 py-2 text-sm font-medium ${isActive ? 'bg-brand text-white' : 'text-slate-600 hover:bg-white'}`}>
              {label}
            </NavLink>
          ))}
        </nav>

        <main>
          <Routes>
            <Route path="/" element={<Dashboard isAdmin={user.role === 'admin'} />} />
            <Route path="/tags" element={<TagsPage />} />
            <Route path="/imports" element={<ImportPage />} />
            <Route path="/pool" element={<PoolPage />} />
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
          <input className="mt-1 w-full rounded-lg border p-2 text-sm" value={email} onChange={e => setEmail(e.target.value)} />
        </label>
        <label className="mt-4 block text-sm font-medium">
          密码
          <input type="password" className="mt-1 w-full rounded-lg border p-2 text-sm" value={password} onChange={e => setPassword(e.target.value)} />
        </label>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <button className="mt-6 w-full rounded-lg bg-brand px-4 py-2 font-semibold text-white">登录</button>
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
          <div>
            <label className="block text-sm font-medium">原密码</label>
            <input type="password" required className="mt-1 w-full rounded-lg border p-2 text-sm" value={oldPassword} onChange={e => setOldPassword(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium">新密码</label>
            <p className="text-xs text-slate-500">至少12位，需包含大小写字母、数字和符号</p>
            <input type="password" required className="mt-1 w-full rounded-lg border p-2 text-sm" value={newPassword} onChange={e => setNewPassword(e.target.value)} />
          </div>
          {error && <Notice message={error} />}
          {success && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{success}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="rounded-lg border px-4 py-2 text-sm font-medium text-slate-600">取消</button>
            <button type="submit" className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">确认修改</button>
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
    <section>
      <h1 className="text-2xl font-bold">标签域管理</h1>
      <p className="mt-1 text-slate-500">按业务隔离标签库与候选池；阈值决定未命中标签累计多少后冻结窗口并触发模型归并。</p>

      {error && <Notice message={error} />}
      {success && <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800 border border-emerald-200">{success}</p>}

      <div className="mt-6 rounded-xl border bg-white p-5">
        <h2 className="font-semibold">创建标签域</h2>
        <form onSubmit={handleCreate} className="mt-4 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[180px]">
            <label className="block text-xs text-slate-500 mb-1">名称</label>
            <input
              required
              placeholder="例如：产品能力 / 行业主题"
              className="w-full rounded-lg border px-3 py-2 text-sm"
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>
          <div className="flex-[2] min-w-[220px]">
            <label className="block text-xs text-slate-500 mb-1">描述（可选）</label>
            <input
              placeholder="用途说明"
              className="w-full rounded-lg border px-3 py-2 text-sm"
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          </div>
          <div className="w-36">
            <label className="block text-xs text-slate-500 mb-1">候选池阈值</label>
            <input
              required
              type="number"
              min={1}
              step={1}
              className="w-full rounded-lg border px-3 py-2 text-sm"
              value={candidateThreshold}
              onChange={e => setCandidateThreshold(Number(e.target.value))}
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-brand px-4 py-2 font-semibold text-white text-sm disabled:opacity-60"
          >
            {submitting ? '创建中…' : '创建标签域'}
          </button>
        </form>
        <p className="mt-3 text-xs text-slate-500">默认阈值 50；设为较小值（如 5）便于联调。创建后暂不支持在界面修改阈值。</p>
      </div>

      <div className="mt-6 overflow-hidden rounded-xl border bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="p-3">名称</th>
              <th className="p-3">描述</th>
              <th className="p-3">候选池阈值</th>
              <th className="p-3">ID</th>
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
                <td className="p-3 text-slate-600">{ns.description || '—'}</td>
                <td className="p-3">
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-mono text-slate-700">{ns.candidateThreshold}</span>
                </td>
                <td className="p-3 font-mono text-xs text-slate-400">{ns.id}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
    <section>
      <h1 className="text-2xl font-bold">用户与角色管理</h1>
      <p className="mt-1 text-slate-500">创建新用户、分配系统角色及审核权限。</p>

      {error && <Notice message={error} />}

      <div className="mt-6 rounded-xl border bg-white p-5">
        <h2 className="font-semibold">创建新用户</h2>
        <form onSubmit={handleCreateUser} className="mt-4 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs text-slate-500 mb-1">用户邮箱</label>
            <input required type="email" placeholder="user@example.com" className="w-full rounded-lg border px-3 py-2 text-sm" value={email} onChange={e => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">系统角色</label>
            <select className="rounded-lg border bg-white px-3 py-2 text-sm" value={role} onChange={e => setRole(e.target.value as Role)}>
              <option value="operator">Operator (仅数据导入)</option>
              <option value="reviewer">Reviewer (审核员)</option>
              <option value="admin">Admin (系统管理员)</option>
            </select>
          </div>
          <div className="flex-1 min-w-[180px]">
            <label className="block text-xs text-slate-500 mb-1">初始密码 (留空随机生成)</label>
            <input type="text" placeholder="可选自定义密码" className="w-full rounded-lg border px-3 py-2 text-sm" value={customPassword} onChange={e => setCustomPassword(e.target.value)} />
          </div>
          <button type="submit" className="rounded-lg bg-brand px-4 py-2 font-semibold text-white text-sm">创建账户</button>
        </form>
        {createdInfo && (
          <div className="mt-4 rounded-lg bg-emerald-50 p-4 text-sm text-emerald-900 border border-emerald-200">
            <p className="font-semibold">用户创建成功！</p>
            <p className="mt-1">账号：<code className="bg-emerald-100 px-1 rounded">{createdInfo.user.email}</code> | 角色：<code className="bg-emerald-100 px-1 rounded">{createdInfo.user.role}</code></p>
            {createdInfo.initialPassword && (
              <p className="mt-1">初始密码：<code className="bg-emerald-200 px-2 py-0.5 rounded font-mono font-bold">{createdInfo.initialPassword}</code> (请牢记并及时通知用户修改)</p>
            )}
          </div>
        )}
      </div>

      <div className="mt-6 overflow-hidden rounded-xl border bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="p-3">用户邮箱</th>
              <th className="p-3">角色</th>
              <th className="p-3">首次登录需改密</th>
              <th className="p-3">创建时间</th>
              <th className="p-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} className="border-t">
                <td className="p-3 font-medium">{u.email}</td>
                <td className="p-3">
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-mono text-slate-700">{u.role}</span>
                </td>
                <td className="p-3 text-slate-600">{u.mustChangePassword ? '是' : '否'}</td>
                <td className="p-3 text-slate-500">{u.createdAt ? new Date(u.createdAt).toLocaleString() : '—'}</td>
                <td className="p-3">
                  <select className="rounded border text-xs p-1 bg-white" value={u.role} onChange={e => handleRoleChange(u.id, e.target.value as Role)}>
                    <option value="operator">Operator</option>
                    <option value="reviewer">Reviewer</option>
                    <option value="admin">Admin</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
    <select className="rounded-lg border bg-white px-3 py-2 text-sm" value={value} onChange={e => onChange(e.target.value)}>
      <option value="">选择标签域</option>
      {namespaces.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
    </select>
  )
}

function Card({ title, value, detail }: { title: string; value: string | number; detail: string }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm text-slate-500">{title}</p>
      <p className="mt-2 text-3xl font-bold">{value}</p>
      <p className="mt-2 text-xs text-slate-500">{detail}</p>
    </article>
  )
}

function Dashboard({ isAdmin }: { isAdmin: boolean }) {
  const { items: namespaces, error } = useNamespaces()
  return (
    <section>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">运营概览</h1>
          <p className="mt-1 text-slate-500">管理标签命中、候选积压和人工审核。</p>
        </div>
        {isAdmin && (
          <NavLink to="/namespaces" className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shrink-0">
            创建标签域
          </NavLink>
        )}
      </div>
      {error ? <Notice message={error} /> : <>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card title="标签域" value={namespaces.length} detail="按业务域隔离规则和候选阈值" />
          <Card title="发布标签" value="—" detail="选择域后可在标签库查看" />
          <Card title="候选池" value="—" detail="达到阈值后自动创建汇总任务" />
          <Card title="待审核" value="—" detail="模型建议必须由人工批准才发布" />
        </div>
        <section className="mt-6 rounded-xl border border-dashed border-slate-300 bg-white p-6">
          <h2 className="font-semibold">开始使用</h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-600">
            <li>
              {isAdmin ? (
                <>
                  <NavLink to="/namespaces" className="text-brand font-medium hover:underline">创建一个标签域并设置候选池阈值</NavLink>
                  。
                </>
              ) : (
                '请管理员创建一个标签域并设置候选池阈值。'
              )}
            </li>
            <li>导入首批标签，候选池任务会调用已配置的 OpenAI 兼容模型。</li>
            <li>在审核中心针对模型建议标签进行逐项（Accept/Edit/Reject）精细化审核与决策。</li>
          </ol>
        </section>
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
    <section>
      <h1 className="text-2xl font-bold">标签库</h1>
      <div className="mt-5 flex flex-wrap gap-3">
        <NamespacePicker value={namespaceId} onChange={setNamespaceId} namespaces={namespaces} />
        <input className="rounded-lg border px-3 py-2 text-sm" placeholder="搜索规范标签" value={query} onChange={e => setQuery(e.target.value)} />
      </div>
      {error && <Notice message={error} />}
      <div className="mt-5 overflow-hidden rounded-xl border bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="p-3">规范标签</th>
              <th className="p-3">别名</th>
              <th className="p-3">描述</th>
              <th className="p-3">版本</th>
            </tr>
          </thead>
          <tbody>
            {tags.map(tag => (
              <tr key={tag.id} className="border-t">
                <td className="p-3 font-medium">{tag.canonicalName}</td>
                <td className="p-3 text-slate-600">{tag.aliases.join('、') || '—'}</td>
                <td className="p-3 text-slate-600">{tag.description || '—'}</td>
                <td className="p-3">v{tag.version}</td>
              </tr>
            ))}
            {namespaceId && tags.length === 0 && (
              <tr>
                <td className="p-6 text-center text-slate-500" colSpan={4}>暂无已发布标签</td>
              </tr>
            )}
          </tbody>
        </table>
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
    <section>
      <h1 className="text-2xl font-bold">批次导入</h1>
      <p className="mt-1 text-slate-500">已命中的规范标签或别名不会新增；未命中项会累计到候选池。</p>
      <form onSubmit={submit} className="mt-6 max-w-3xl rounded-xl border bg-white p-5">
        <div className="flex flex-wrap gap-3">
          <NamespacePicker value={namespaceId} onChange={setNamespaceId} namespaces={namespaces} />
          <input className="rounded-lg border px-3 py-2 text-sm" placeholder="来源名称，例如 2026-Q3 产品数据" value={sourceName} onChange={e => setSourceName(e.target.value)} />
        </div>
        <label className="mt-4 flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={initialSeed} onChange={e => setInitialSeed(e.target.checked)} />
          这是首批基线标签：立即创建模型整理任务
        </label>
        <textarea className="mt-4 min-h-60 w-full rounded-lg border p-3 text-sm font-mono" placeholder="每行一个标签，也可用逗号分隔" value={raw} onChange={e => setRaw(e.target.value)} />
        {(message || error) && <Notice message={message || error} />}
        <button disabled={!namespaceId || !raw.trim()} className="mt-4 rounded-lg bg-brand px-4 py-2 font-semibold text-white text-sm disabled:opacity-50">提交并处理</button>
      </form>
      {result && (
        <div className="mt-5 grid gap-3 sm:grid-cols-4">
          <Card title="总计" value={result.totalCount} detail="原始输入" />
          <Card title="已命中" value={result.matchedCount} detail="未新增标签" />
          <Card title="进入候选池" value={result.pooledCount} detail="等待阈值触发" />
          <Card title="无效项" value={result.invalidCount} detail={result.jobId ? '已创建汇总任务' : '等待阈值'} />
        </div>
      )}
    </section>
  )
}

function PoolPage() {
  const { items: namespaces } = useNamespaces()
  const [namespaceId, setNamespaceId] = useState('')
  const [items, setItems] = useState<PoolEntry[]>([])
  const [threshold, setThreshold] = useState(0)
  useEffect(() => { if (namespaceId) api.pool(namespaceId).then(x => { setItems(x.data); setThreshold(x.threshold) }) }, [namespaceId])
  const progress = useMemo(() => threshold ? Math.min(100, Math.round(items.length / threshold * 100)) : 0, [items, threshold])
  return (
    <section>
      <h1 className="text-2xl font-bold">候选池</h1>
      <p className="mt-1 text-slate-500">达到阈值时冻结当前集合，模型只处理冻结快照，避免新数据扰动审核。</p>
      <div className="mt-5"><NamespacePicker value={namespaceId} onChange={setNamespaceId} namespaces={namespaces} /></div>
      {namespaceId && <>
        <div className="mt-5 rounded-xl border bg-white p-5">
          <div className="flex justify-between text-sm"><span>本轮候选 {items.length} / 阈值 {threshold}</span><span className="font-semibold text-brand">{progress}%</span></div>
          <div className="mt-3 h-2 overflow-hidden rounded bg-slate-100"><div className="h-full bg-brand" style={{ width: `${progress}%` }} /></div>
        </div>
        <div className="mt-5 overflow-hidden rounded-xl border bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="p-3">规范化值</th>
                <th className="p-3">原始样本</th>
                <th className="p-3">出现次数</th>
                <th className="p-3">最近出现</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={item.id} className="border-t">
                  <td className="p-3 font-medium">{item.normalizedName}</td>
                  <td className="p-3">{item.rawSample}</td>
                  <td className="p-3">{item.occurrenceCount}</td>
                  <td className="p-3 text-slate-500">{new Date(item.lastSeenAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>}
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
        [tagId]: { ...prev[proposalId]?.[tagId], ...patch } as ItemEditState
      }
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
    <section>
      <h1 className="text-2xl font-bold">审核中心</h1>
      <p className="mt-1 text-slate-500">支持逐项 Accept/Reject 与编辑修正。批准后选中的规范标签及别名将落库，驳回将带反馈重新进入模型。</p>
      {error && <Notice message={error} />}

      <div className="mt-6 space-y-6">
        {proposals.map(proposal => (
          <article key={proposal.id} className="rounded-xl border bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
              <div>
                <p className="font-semibold text-lg">提案 {proposal.id.slice(0, 8)}</p>
                <p className="mt-1 text-sm text-slate-500">生成时间：{new Date(proposal.createdAt).toLocaleString()} · 关联版本 v{proposal.version}</p>
              </div>
              <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">{proposal.status}</span>
            </div>

            <div className="mt-5 space-y-4">
              <h3 className="text-sm font-semibold text-slate-700">模型建议标签列表 (可逐项采纳与编辑)</h3>
              {proposal.tags.map(tag => {
                const edit = itemEdits[proposal.id]?.[tag.id] ?? { accepted: true, canonicalName: tag.canonicalName, description: tag.description, aliases: tag.aliases.join(', ') }
                return (
                  <div key={tag.id} className={`rounded-xl border p-4 transition-colors ${edit.accepted ? 'border-slate-200 bg-slate-50/50' : 'border-red-200 bg-red-50/30'}`}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => updateItem(proposal.id, tag.id, { accepted: !edit.accepted })}
                          className={`rounded-lg px-3 py-1 text-xs font-bold transition-colors ${edit.accepted ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-600'}`}
                        >
                          {edit.accepted ? '✓ 已采纳 (Accept)' : '✕ 已忽略 (Reject)'}
                        </button>
                        <span className="text-xs font-semibold text-brand bg-brand/10 px-2 py-0.5 rounded">置信度 {Math.round(tag.confidence * 100)}%</span>
                      </div>
                      <span className="text-xs text-slate-500">覆盖 {tag.coveredEntryIds.length} 个候选原词</span>
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">规范名称 (Canonical Name)</label>
                        <input
                          disabled={!edit.accepted}
                          className="w-full rounded-lg border px-3 py-1.5 text-sm bg-white font-medium disabled:opacity-50"
                          value={edit.canonicalName}
                          onChange={e => updateItem(proposal.id, tag.id, { canonicalName: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">别名 (逗号分隔)</label>
                        <input
                          disabled={!edit.accepted}
                          className="w-full rounded-lg border px-3 py-1.5 text-sm bg-white disabled:opacity-50"
                          value={edit.aliases}
                          onChange={e => updateItem(proposal.id, tag.id, { aliases: e.target.value })}
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-xs text-slate-500 mb-1">描述说明</label>
                        <input
                          disabled={!edit.accepted}
                          className="w-full rounded-lg border px-3 py-1.5 text-sm bg-white disabled:opacity-50"
                          value={edit.description}
                          onChange={e => updateItem(proposal.id, tag.id, { description: e.target.value })}
                        />
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-slate-500">归纳理由：{tag.rationale || '—'}</p>
                  </div>
                )
              })}
            </div>

            <div className="mt-5">
              <label className="block text-xs text-slate-500 mb-1">审核意见 / 驳回修改反馈</label>
              <textarea
                className="min-h-20 w-full rounded-lg border p-3 text-sm bg-white"
                placeholder="若要驳回，请填写给 LLM 的反馈指导（如：请勿将开发与运营合并）"
                value={comments[proposal.id] ?? ''}
                onChange={e => setComments({ ...comments, [proposal.id]: e.target.value })}
              />
            </div>

            <div className="mt-4 flex gap-3 pt-2">
              <button
                disabled={busy === proposal.id}
                onClick={() => decide(proposal, true)}
                className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                批准并提交决策 (Approve)
              </button>
              <button
                disabled={busy === proposal.id}
                onClick={() => decide(proposal, false)}
                className="rounded-lg border border-red-300 bg-white px-5 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                全案驳回并重跑 (Reject & Rework)
              </button>
            </div>
          </article>
        ))}

        {proposals.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
            <p className="font-medium">暂无待审核提案</p>
            <p className="mt-2 text-sm text-slate-500">候选池达到阈值、worker 成功调用模型后，提案会出现在这里。</p>
          </div>
        )}
      </div>
    </section>
  )
}

function Notice({ message }: { message: string }) {
  return <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{message}</p>
}
