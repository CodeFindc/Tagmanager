# Tag Manager 下一步实施计划书

> 版本：v1（对应 commit `fc7020e`）。面向接手工程师，列出尚未实现或需收尾的项，按优先级分组。
> 配套阅读：[`ARCHITECTURE.md`](./ARCHITECTURE.md)（当前已实现架构）。

每项标注：**优先级**（P0 阻塞上线 / P1 上线前应做 / P2 可迭代）、**涉及模块**、**验收标准**。

---

## P0 — 上线前必须修复

### 1. worker 重试上限读取配置而非硬编码
- **现状**：`backend/internal/worker/worker.go` 的 `fail()` 硬编码 `attempt >= 3`，未读取 `cfg.LLM.MaxRetries`（配置项已存在但被忽略）。
- **影响**：运维无法调整重试次数；死信阈值与配置脱节。
- **方案**：把 `Worker` 结构体增加 `maxAttempts int` 字段，`New()` 从 `config.LLMConfig.MaxRetries` 注入；`fail()` 用 `w.maxAttempts`。同时把退避从固定 30s 改为指数退避（`run_after = now() + (2^attempt) * 10s`，上限 5 分钟）。
- **验收**：单元测试覆盖 `attempt == maxAttempts-1` 转 `retryable_failed`、`attempt == maxAttempts` 转 `failed`；改环境变量 `LLM_MAX_RETRIES=1` 后行为随之变化。

### 2. 导入接口强制要求 Idempotency-Key
- **现状**：`backend/internal/httpapi/api.go` 的 `importTags()` 在缺 `Idempotency-Key` 头时生成随机 UUID，破坏幂等语义——重复提交会创建重复批次。
- **影响**：网络重试或前端重复点击会产生重复导入和重复候选计数。
- **方案**：缺 key 时返回 `400` 并提示 `Idempotency-Key header is required`，不再兜底生成。前端 `lib/api.ts` 已正确带 `crypto.randomUUID()`，无需改前端。
- **验收**：无 key 请求返回 400；相同 key 重复提交返回同一批次、不重复累计候选计数。

### 3. 提交遗留文档并锁定版本
- **现状**：`docs/ARCHITECTURE.md` 与本文档为新增未提交；前端 `package.json` 依赖全 `latest`，构建不可复现。
- **方案**：提交 `docs/`；把 `frontend/package.json` 的 `latest` 替换为 `package-lock.json` 中实际解析的版本号（`npm ls` 查询），确保 `npm ci` 可复现。
- **验收**：`npm ci` 干净环境成功；删除 `node_modules` 后重装版本一致。

---

## P1 — 上线前应完成

### 4. 用户管理与角色分配接口
- **现状**：只能靠 `SeedAdmin` 创建 admin，无法通过 API 创建 reviewer/operator，无法开展审核工作。
- **方案**：新增 `POST /users`（admin 专用，创建账户并指定 role，密码首次随机、登录后强制改密）、`GET /users`、`PATCH /users/:id/role`、`POST /auth/change-password`。密码强度校验（≥12 位、混合字符）。新增 `password_changed_at` 字段并在 JWT claims 中携带，强制首次登录改密。
- **涉及**：`migrations/002_users.sql`（加列）、`repository`、`httpapi`、前端「系统配置」页。
- **验收**：admin 可创建 reviewer；reviewer 首次登录被重定向到改密页；弱密码被拒。

### 5. 列表分页
- **现状**：`ListTags` / `ListPool` / `ListProposals` 全量返回，数据量大时会拖垮内存与响应。
- **方案**：统一 `?limit=&cursor=` 游标分页（基于 `created_at` + `id` 复合游标，避免 OFFSET 性能问题）；响应包 `{data, nextCursor, total}`。前端列表接入"加载更多"。
- **验收**：导入 10k 标签后标签库查询响应 < 200ms；游标翻页无重复无遗漏。

### 6. 后端集成测试（repository 层）
- **现状**：仅有 `normalizer` 和 `worker.validateOutput` 单测，无任何数据库层测试，核心不变量未验证。
- **方案**：用 `testcontainers-go` 起 Postgres，写 `store_test.go` 覆盖：
  - 幂等导入（相同 key 返回历史结果、候选计数不重复累加）。
  - 阈值触发冻结窗口（候选数 = threshold-1 不冻结，= threshold 冻结并建任务）。
  - 并发窗口冻结（partial unique index 阻止第二个活跃窗口）。
  - 原子发布（approve 后 tags/aliases 落库、候选 resolved、proposal version+1）。
  - 409 并发审核（两个 goroutine 同时 decide，只有一个成功）。
  - 驳回 rework（reject 后出现 `parent_proposal_id` 的新任务）。
- **涉及**：`backend/tests/`、`go.mod` 加 `testcontainers-go`。
- **验收**：CI 中集成测试通过；这些测试本身也是回归保护。

### 7. LLM 适配器单元测试
- **现状**：`internal/llm/openai.go` 无测试，JSON 解析、非 2xx、空 choices、格式错误等分支未覆盖。
- **方案**：用 `net/http/httptest` 起 mock OpenAI 端点，测试用例：
  - 正常响应 → 正确解码 `ConsolidationOutput`。
  - HTTP 500 → 返回带状态码的错误。
  - `choices` 为空 → 错误。
  - `content` 非 JSON → 错误。
  - baseURL/apiKey/model 任一为空 → "not configured" 错误。
  - 验证请求体含 `response_format: json_schema, strict:true` 与 `temperature:0`。
- **验收**：`go test ./internal/llm` 全绿，覆盖率 > 80%。

### 8. 错误响应统一与脱敏
- **现状**：多处 `respondError(w, 500, err.Error())` 把内部错误（含 SQL 细节）直接暴露给客户端。
- **方案**：定义 `apperror` 类型（code/httpStatus/message/internalErr），repository/service 只返回 `apperror`，httpapi 统一映射；500 仅返回通用消息，详情写日志。新增 `GET /healthz`（存活）与 `GET /readyz`（含 DB ping）。
- **验收**：触发 DB 错误时客户端只看到通用 500 文案，日志含完整错误与 requestID。

### 9. 审核逐项决策的前端能力
- **现状**：前端 `ReviewPage` 只有整体批准/驳回按钮，未实现逐项 accept/edit/reject（后端 `DecideProposal` 已支持 `Tags[].Accepted/CanonicalName/Description/Aliases`）。
- **方案**：每个 `proposal_tag` 卡片加 accept/reject 切换、可编辑 canonicalName/description/aliases 的内联表单；提交时构造 `tags[]` 数组。驳回反馈 textarea 已有。
- **验收**：可只批准 3 个标签中的 2 个并编辑名称；提交后只有这 2 个发布，第 3 个不发布且窗口 approved。

---

## P2 — 可迭代增强

### 10. JWT 刷新机制
- 用 `refresh_token`（httpOnly cookie，7d）+ `access_token`（15m），`POST /auth/refresh`。前端 401 时自动刷新。

### 11. 导入批量上限与流式上传
- 当前 `MaxBytesReader(2<<20)` = 2MB。改为支持 CSV 文件上传（`multipart/form-data`），服务端流式解析，单批上限 100k 行；超大返回 413 并提示分批。

### 12. 运维与可观测性
- `GET /metrics`（Prometheus）：导入吞吐、命中率、候选积压、任务耗时/失败率、模型 token/成本、审核通过率。
- 结构化日志加 requestID（中间件注入 + context 传递）。
- `/consolidation-jobs` 列表与 `POST /:id/retry` 手动重放死信任务。

### 13. 标签归档与导出
- schema 有 `archived` 状态但无 API：新增 `POST /tags/:id/archive`（admin）、`GET /tags/export?namespaceId=&format=csv|json`。

### 14. 前端 Dashboard 真实统计
- 当前三张卡片显示 `—`。新增 `GET /stats/overview`（标签数、命中率、候选距阈值、待审核数、失败任务数、近期 token 开销），前端接入。

### 15. Docker Compose 端到端冒烟（待 Docker 环境）
- 本机无 Docker 未验证。在有 Docker 的环境跑完整 E2E：
  1. `docker compose up --build`。
  2. 登录 → 创建域（阈值 5）→ 导入首批 5 标签（initialSeed）。
  3. 用 mock LLM（环境变量指向本地 httptest 或 stub 服务）验证 worker 生成提案。
  4. 审核批准 → 验证 tags 发布、候选 resolved。
  5. 再导入含已发布标签的批次 → 验证命中不进池。
  6. 导入 5 个未命中 → 验证只创建一个汇总任务。
  7. 驳回一个提案 → 验证 rework 任务带 feedback。
  8. 检查 audit_logs 完整链路。
- **建议**：写 `scripts/e2e-smoke.sh` 用 curl + jq 自动化，纳入 CI（需 service 容器）。

---

## 交接清单

接手工程师建议按此顺序推进：

1. **P0-1、P0-2、P0-3**（半天）——修硬编码、强制幂等头、提交文档与锁版本。这些是阻塞项。
2. **P1-6、P1-7**（1-2 天）——补集成测试与 LLM 单测，建立回归保护网，之后重构才安全。
3. **P1-4**（1 天）——用户管理，否则审核流程跑不起来。
4. **P1-8、P1-9**（1 天）——错误脱敏 + 前端逐项审核，提升可用性。
5. **P1-5**（1 天）——分页，预防数据量增长。
6. **P2 项**按业务优先级迭代。
7. **P2-15**——在有 Docker 的环境做端到端冒烟，作为上线前最后一道关卡。

## 验证命令速查

```bash
# 后端（从 backend/，本机 Go 需 PATH 前缀）
export PATH="$PATH:/c/Program Files/Go/bin"
gofmt -l .          # 应为空
go vet ./...
go test ./...       # 含 service + worker 单测
go build -o /tmp/tag-api ./cmd/api && go build -o /tmp/tag-worker ./cmd/worker

# 前端（从 frontend/）
npm run lint
npm run build       # tsc -b && vite build

# CI 工作流
.github/workflows/ci.yml   # 后端 mod tidy/gofmt/vet/test/build + 前端 install/build
```

## 关键约束（交接时务必传达）

- **模型密钥只存后端环境变量**，绝不传浏览器或入审计日志。
- **首版只做规范化精确命中**（normalized_name + 已批准 alias），不自动按语义相似度合并——这是产品定位，不是 bug。
- **真实 LLM 调用预生产用 mock/测试项目验收**，不要拿生产 key 在 CI 跑。
- LLM 接口是 **OpenAI-compatible**，不绑定特定供应商。
- 所有多步写操作（导入、提案持久化、审核决策）**必须在单个数据库事务内**，这是数据一致性的底线。