# Tag Manager 架构设计文档

> 版本：v1（对应 commit `fc7020e`）。本文与代码逐行对齐；任何与代码冲突之处以代码为准。
> 维护者：交接时请同时阅读 [`PLAN-NEXT.md`](./PLAN-NEXT.md)（未实现项计划书）。

## 1. 项目定位

Tag Manager 是一个 **LLM 辅助的、可人工审核的标签库管理系统**。

核心思想：

- 通过**确定性规则**先匹配已发布标签（规范化精确名称 + 已批准别名命中）。
- 未命中的原始标签以规范化名称聚合，累计进**候选池**。
- 候选池达到阈值后，**冻结一个窗口**并交给 OpenAI 兼容大模型归并出"待审核的标签增量提案"。
- **只有人工审核批准后**标签才会发布；驳回则携带反馈重新进入模型重试任务。

这是一个典型的 "AI 生成 + Human-in-the-loop 审核" 工作流系统，强调**可审核性、幂等性、事务一致性**。

### 不可破坏的不变量

1. **首版只做规范化精确命中**（`normalized_name` + 已批准 `alias`），**不做语义相似度自动合并**。
2. 命中已发布标签**不新增**；未命中 upsert 进 `candidate_pool_entries`；累计到 namespace 的 `candidate_threshold`（默认 50）或 `initial_seed` 才冻结 `pool_window` 并投递 `consolidation_job`。
3. 每个 namespace 同时**只有一个活跃窗口**（partial unique index 保证）。
4. 模型输出必须通过 **JSON Schema strict 校验 + worker `validateOutput`**（canonical 非空、`coveredIds` 全部存在于输入、无重复覆盖）才可落库为提案。
5. 审核通过在**同一事务**内原子发布 `tags`/`tag_aliases` 并 resolve 候选；驳回带 `reviewer_feedback` 创建 `rework` 任务；`FOR UPDATE` + version 校验，版本不匹配返回 409。
6. **模型密钥只存后端环境变量**，绝不传浏览器或入审计日志。LLM 接口为 OpenAI-compatible（非必然 Anthropic）。
7. 真实模型调用应在预生产用 mock/测试项目验收。

## 2. 技术架构

```
┌─────────────┐     ┌──────────────────────────┐     ┌────────────┐
│  Frontend   │────▶│  Backend API (Go/chi)     │────▶│ PostgreSQL │
│ React+Vite  │     │  - JWT 认证               │     │ (含队列表)  │
│ +Tailwind   │     │  - RBAC (admin/reviewer)  │     └────────────┘
└─────────────┘     └──────────────────────────┘            ▲
                           │                                │
                    ┌──────┴───────┐   轮询领取任务          │
                    │ Worker (Go)  │────────────────────────┘
                    │ - 调用 LLM    │
                    │ - JSON Schema │
                    └──────────────┘
                           │
                    ┌──────▼──────┐
                    │ LLM (OpenAI  │
                    │  compatible) │
                    └─────────────┘
```

### 2.1 后端（`backend/`，Go 1.24）

分层架构（DDD 风格）：

| 目录 | 职责 |
|---|---|
| `cmd/api` | HTTP 服务入口。`signal.NotifyContext` + 优雅关停，`ReadHeaderTimeout: 10s`。 |
| `cmd/worker` | 队列 worker 入口。2 秒 ticker 轮询 `consolidation_jobs`。 |
| `internal/app` | 共享初始化：`Open` → 连库 → `Migrate` → `SeedAdmin`（bcrypt 哈希 + `ON CONFLICT DO NOTHING`）。 |
| `internal/config` | 环境变量加载 + 校验。`DATABASE_URL` 必填，`JWT_SECRET` ≥ 32 字符。`LLMConfig{BaseURL,APIKey,Model,Timeout,MaxRetries}`。 |
| `internal/domain` | 纯领域模型：`Role`、`User`、`Namespace`、`Tag`、`ImportResult`、`PoolEntry`、`Proposal`、`ProposalTag`、`ConsolidationOutput`、`ConsolidatedTag`。 |
| `internal/repository` | PostgreSQL 数据访问（pgx/v5）。`Database`（连接池 + 自研迁移器 + `SeedAdmin`）、`Store`（业务查询 + `ImportTags`）、`proposals.go`（`ListProposals` + `DecideProposal`）。 |
| `internal/service` | `NormalizeTag`（确定性规范化）、`auth`（bcrypt + JWT HS256，8h 过期，`TokenClaims{Role, RegisteredClaims}`）。 |
| `internal/httpapi` | chi 路由 + CORS + JWT 中间件 + RBAC（`require(role, handler)`）。 |
| `internal/worker` | `Worker.Run`（2s ticker）+ `ProcessOne`（`claim` → 取快照/反馈 → 调 LLM → `validateOutput` → `persistProposal`）+ `fail`（重试/死信）。 |
| `internal/llm` | `Client` 接口 + `OpenAICompatibleClient`（Chat Completions，strict JSON Schema）。 |
| `migrations/` | `001_initial.sql`：完整 schema。迁移器读 `migrations/*.sql` 按文件名排序，用 `schema_migrations` 表去重，每个文件单事务应用。 |

### 2.2 前端（`frontend/`，React 19 + TypeScript + Vite 8 + Tailwind v4）

- 单页应用，`react-router-dom` 路由，5 个页面：概览 / 标签库 / 批次导入 / 候选池 / 审核中心。
- `lib/api.ts`：统一 fetch 封装，JWT 存 `localStorage`，导入带 `Idempotency-Key: crypto.randomUUID()`。
- `types/api.ts`：与后端契约对齐的 TypeScript 接口。
- `App.tsx`：登录态检查 + 基于角色的操作禁用 + 乐观刷新。
- Tailwind v4 via `@tailwindcss/vite`，自定义主题色（`ink`/`paper`/`brand`/`mint`）。

### 2.3 基础设施

- `compose.yaml`：4 服务（postgres / api / worker / frontend），healthcheck + `depends_on: condition: service_healthy`，named volume `postgres-data`。
- `backend/Dockerfile`：多阶段 `golang:1.24-alpine` 构建 → `alpine:3.21` 运行，非 root `appuser`，拷贝 `migrations/`。
- `frontend/Dockerfile` + `nginx.conf`：构建静态资源 + Nginx 代理 `/api` 到 api 服务。
- `.github/workflows/ci.yml`：后端（`go mod tidy` / `gofmt -l` / `vet` / `test` / `build`）+ 前端（`npm install` / `build`）。

## 3. 数据模型与状态机

### 3.1 关键表（`migrations/001_initial.sql`）

| 表 | 作用 | 关键约束 |
|---|---|---|
| `users` | 账户 | `email` 唯一（lower），`role` enum(admin/reviewer/operator) |
| `tag_namespaces` | 标签域 | `candidate_threshold > 0`，默认 50 |
| `tags` | 已发布规范标签 | `UNIQUE(namespace_id, normalized_name)`，`status` enum(published/archived)，`version` 自增 |
| `tag_aliases` | 已批准别名 | `UNIQUE(namespace_id, normalized_name)`，`ON DELETE CASCADE` |
| `import_batches` | 导入批次 | `idempotency_key` 唯一（幂等） |
| `import_items` | 逐行结果 | `UNIQUE(batch_id, line_number)`，`status` enum(matched/pooled/invalid) |
| `candidate_pool_entries` | 未命中候选 | `UNIQUE(namespace_id, normalized_name)` upsert，`occurrence_count` 自增，`resolved_at` 标记解决 |
| `pool_windows` | 冻结窗口 | **partial unique index** `pool_windows_active_unique ON (namespace_id) WHERE status IN ('frozen','generating','awaiting_review')` |
| `consolidation_jobs` | 任务队列 | `FOR UPDATE SKIP LOCKED` 消费，`attempt` 计数，`run_after` 退避，`parent_proposal_id` 关联驳回 |
| `consolidation_proposals` | 模型提案 | `version` 乐观锁，`status` enum(pending_review/approved/rejected)，`reviewer_feedback` |
| `proposal_tags` | 提案内标签 | `aliases` JSONB，`confidence` NUMERIC(4,3)，`accepted`/`edited_*` 记录审核调整 |
| `proposal_mappings` | 标签→候选覆盖 | `UNIQUE(proposal_tag_id, candidate_pool_entry_id)` |
| `review_decisions` | 审核记录 | reviewer + decision + comments |
| `audit_logs` | 审计 | actor + action + entity + JSONB data |

### 3.2 状态机

**批次项**：`pending → normalized → matched | pooled | invalid`。同一 `idempotency_key` 重复提交返回历史结果，不创建重复记录。

**候选窗口**：`frozen → generating → awaiting_review → approved | rejected | failed`。冻结后新输入进入下一轮，避免模型工作期间集合漂移。

**模型任务**：`queued → running → succeeded | retryable_failed → (重试) | failed`。指数退避、有限重试（当前硬编码 attempt≥3 转 failed，详见遗留项）。

**审核提案**：`pending_review → approved | rejected`。只有 `approved` 的增量可写入已发布标签表。version 乐观锁阻止并发审核造成重复发布。

### 3.3 端到端流程

1. **创建域** → 设定阈值（`POST /namespaces`，admin）。
2. **导入标签**（`POST /imports`，admin，需 `Idempotency-Key`，事务内）：
   - 幂等：`idempotency_key` 命中则返回历史结果。
   - 规范化 → 精确匹配已发布 tag/alias（`UNION ALL`）→ 命中记 `matched`，不创建增量。
   - 未命中 → `ON CONFLICT` 聚合到候选池（`occurrence_count` 自增）。
   - 候选数 ≥ 阈值**或** `initial_seed` 且无活跃窗口 → 冻结窗口（快照 ≤500 条）+ 创建 `consolidation_jobs`（`job_type` = `pool_window` / `initial_seed`）。
3. **Worker**（`ProcessOne`）：
   - `claim()`：`WITH next AS (SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE ... SET status='running', attempt=attempt+1`。
   - 分步查询 namespace 名、窗口快照、rework 反馈（`LEFT JOIN` parent proposal 的 `reviewer_feedback`）。
   - 调 LLM（strict JSON Schema），`validateOutput` 校验 `coveredIds` 必须引用真实候选、不可重复映射。
   - `persistProposal`：单事务插入 `consolidation_proposals` + `proposal_tags` + `proposal_mappings`，job→`succeeded`，window→`awaiting_review`。
   - 失败 → `fail`：`attempt >= 3` 转 `failed`，否则 `retryable_failed` + `run_after = now()+30s`，window→`failed`。
4. **人工审核**（`POST /review/proposals/{id}/decision`，reviewer，事务内）：
   - `SELECT ... FOR UPDATE` + version 校验（不匹配返回 409）。
   - 批准：逐个 accepted tag → upsert 发布标签（`version+1`）+ 重建别名 + 标记候选 `resolved_at`；窗口→`approved`。
   - 驳回：保留 feedback，新建 `rework` 任务（`parent_proposal_id`）；窗口→`rejected`。
   - 记录 `review_decisions` + `audit_logs`。

## 4. 设计亮点

1. **确定性优先，AI 在后**：首版只用规范化精确匹配，不自动语义合并——降低误并风险，符合"可审核"定位。
2. **三层并发控制**：窗口 partial unique index（每 namespace 一个活跃窗口）、任务 `FOR UPDATE SKIP LOCKED`（无重复消费）、提案 `FOR UPDATE` + version 乐观锁（无并发重复发布）。
3. **幂等导入**：`Idempotency-Key` 头 + 数据库唯一约束。
4. **LLM 输出强校验**：strict JSON Schema + worker 端 `coveredIds` 白名单/去重校验——防止模型幻觉伪造 ID。
5. **密钥隔离**：LLM 密钥仅在后端环境变量，不进审计日志、不传浏览器。
6. **事务一致性**：所有多步写操作都在单个事务内（导入、提案持久化、审核决策）。
7. **可追溯**：`audit_logs` + `review_decisions` + `source_proposal_id` + `parent_proposal_id` 形成完整审计链。

## 5. 当前实现边界与已知遗留

> 详见 [`PLAN-NEXT.md`](./PLAN-NEXT.md)。此处仅列交接工程师必须知道的关键项。

- **worker 重试上限硬编码** `attempt >= 3`，未读取 `cfg.LLM.MaxRetries`。
- **导入缺 `Idempotency-Key` 时生成随机 UUID**，破坏幂等语义（前端 `crypto.randomUUID()` 已带，但 curl 直连会失效）。
- **无用户管理接口**：只能靠 seed admin，无法通过 API 创建 reviewer/operator。
- **无分页**：`ListTags`/`ListPool`/`ListProposals` 全量返回。
- **前端 Dashboard 统计卡片为 `—` 占位**，未实现真实统计。
- **前端依赖全部 `latest`**，不可复现构建。
- **无 repository/worker/httpapi 集成测试**（仅 normalizer + validateOutput 单测）。
- **`MaxBytesReader(2<<20)` = 2MB**，大批量导入会失败。
- **JWT 无刷新机制**（8h 硬过期）。
- **Docker Compose 端到端冒烟未在本机验证**（无 Docker 环境）。
