# Tag Manager

一个前后端分离的标签管理库：通过确定性规则命中已发布标签，将未命中标签累计进候选池，达到阈值后由 OpenAI-compatible 大模型归并为待审核的标签增量。**只有人工审核通过的标签才会发布**；驳回反馈会进入后续模型重试任务。

## 架构

- `backend/`：Go HTTP API 与 PostgreSQL 队列 worker。
- `frontend/`：React + TypeScript + Vite + Tailwind CSS 管理控制台。
- PostgreSQL：标签、别名、导入批次、候选池、冻结窗口、模型任务、审核提案和审计记录。
- LLM：通过 `LLM_BASE_URL` 接入 Chat Completions 兼容接口；模型调用使用 JSON Schema 约束输出。

## 核心流程

1. 创建标签域并为该域设定候选池阈值（默认 50）。
2. 导入原始标签。服务会规范化名称并精确匹配已发布标签及别名：命中项只记录结果，不创建增量；未命中项会以规范化名称聚合到候选池。
3. 未解决候选的数量达到阈值时，事务内冻结一个窗口并创建唯一模型任务；之后到达的新候选自动留给下一窗口。
4. worker 从 PostgreSQL 队列表领取任务，调用模型，并验证模型输出引用的候选 ID、覆盖映射和必需字段。
5. 审核者在控制台批准后，标签和别名会在一个事务中发布，覆盖的候选项标记为已解决；驳回会保留反馈并新建重试任务。

## 本地启动

### Docker Compose

```bash
copy .env.example .env
# 在 .env 中设置安全的 JWT_SECRET、PostgreSQL 密码和 LLM_* 参数
docker compose up --build
```

- 控制台：<http://localhost:4173>
- API：<http://localhost:8080/api/v1>
- 默认开发登录：`admin@example.com` / `change-me-now`（启动前必须修改）。

### 单独开发

```bash
# 先启动 PostgreSQL，配置 DATABASE_URL / JWT_SECRET
cd backend
go mod tidy
go run ./cmd/api
# 第二个终端
go run ./cmd/worker

cd ../frontend
npm install
npm run dev
```

## 环境变量

| 变量 | 用途 |
| --- | --- |
| `DATABASE_URL` | PostgreSQL DSN；API 与 worker 都需要。 |
| `JWT_SECRET` | 不少于 32 个字符的 JWT 签名密钥。 |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | 空数据库启动时创建的管理员。 |
| `LLM_BASE_URL` | OpenAI-compatible API 基地址，通常含 `/v1`。 |
| `LLM_API_KEY` / `LLM_MODEL` | 模型供应商凭证和模型名称。 |
| `LLM_TIMEOUT_SECONDS` / `LLM_MAX_RETRIES` | 请求超时与任务重试上限。 |

## 重要运营约束

- 模型密钥只保留在后端环境变量，绝不传递给浏览器或写入审计日志。
- 首版仅使用规范化后的精确名称和别名命中，**不自动按语义相似度合并**。
- 建议生产环境使用独立的低权限数据库账户、密钥管理服务和 TLS 数据库连接。
- 真实模型调用应在预生产环境先使用供应商的测试项目或 mock 进行验收。
