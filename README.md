# TagManager 标签治理与大模型归并平台

一个前后端分离的企业级标签治理与智能归并中台系统。通过**确定性规则命中**已发布标签，将未命中候选词滚动累积至缓冲池；达到阈值后自动触发 **OpenAI-compatible LLM 长上下文结构化归并**，生成可审核的标签提案。

系统坚守**“人机协同、人工最终判决”**准则——**只有人工审核批准的标签才会发布**。提供 **AI 智能助审流式推理 (SSE)**、**待审核/已审核提案别名单独回退**、**主标签级联逻辑归档 (`status = 'archived'`)**、**第三方打标匹配 API** 以及**卡片式悬浮 Dashboard UI (支持 Dark Mode)**。

---

## 🏛️ 系统架构拓扑

```mermaid
graph TD
    A["数据导入 (Batch Import)"] --> B["规则精准匹配引擎 (Exact Match)"]
    B -- "命中已发布标签/别名" --> C["记录匹配关联结果"]
    B -- "未命中原始样本" --> D["候选词缓冲池 (Candidate Pool)"]
    
    D -- "未解决词数 ≥ 触发阈值" --> E["冻结池窗口 (Pool Window)"]
    E --> F["LLM 归并任务队列 (Consolidation Worker)"]
    
    F --> G["OpenAI-compatible 大模型 Reasoning"]
    G --> H["JSON Schema 格式校验 & 生成审核提案"]
    
    H --> I["智能助审中心 (Review Center)"]
    I -. "SSE 流式推演 / 打字机 preview" .-> J["AI 助审 Copilot (5s Nginx 心跳保活)"]
    
    I -- "人工批准 (Approve)" --> K["写数据库发布 Tags & Tag_Aliases"]
    I -- "别名回退 (Revert Alias)" --> L["释放对应候选词 (resolved_at = NULL) 重返候选池"]
    I -- "主标签全回退级联" --> M["逻辑归档主标签 (status = 'archived')"]
    
    K --> N["第三方系统打标匹配 API (/api/v1/tags/match)"]
```

---

## 🛠️ 技术栈清单

### 后端 (Backend)
- **核心语言与框架**: Go 1.23+, `Chi` Router (轻量高性能 HTTP 路由)
- **数据库与连接池**: PostgreSQL 16+, `jackc/pgx/v5` (高性能事务与连接池控制)
- **身份鉴权与安全**: JWT (JSON Web Tokens), `golang-jwt/jwt/v5`, bcrypt 密码哈希
- **大模型与实时流**: OpenAI Go SDK, SSE (`text/event-stream`) 实时长连接, 5 秒代理心跳保活
- **异步任务队列**: 基于 PostgreSQL 事务锁的数据库并发任务 Worker 队列

### 前端 (Frontend)
- **核心框架**: React 18, TypeScript, Vite (极速构建与热重载)
- **样式与设计系统**: Tailwind CSS v4, Vanilla CSS Theme Variables
- **布局与主题**: “卡片式悬浮、四周留白” 现代 Dashboard 架构, `☀️ 明亮 / 🌙 暗色 (Dark Mode)` 全站一键切换与持久化
- **路由与状态**: React Router v6, ReadableStream 流式响应解析器

### 代理与 DevOps
- **反向代理**: Nginx (支持 SSE 流式无缓冲代理 `proxy_buffering off`, `proxy_read_timeout 600s`)
- **容器化部署**: Docker, Docker Compose (内置国内 1ms.run 镜像源加速部署文件 `compose.accelerated.yaml`)

---

## 🚀 核心功能特性

### 1. 确定性打标与候选池缓冲累积
- 导入原始文本批次时，引擎自动规范化名称（小写、去空格、去特殊字符）。
- 优先与数据库已发布的规范标签及别名执行确定性精确匹配。
- 未命中词条以 `normalized_name` 聚合累积至候选词池。当未解决候选词数量达到标签域设定的触发阈值（默认 50 条）时，自动冻结窗口并派发归并任务。

### 2. 大模型结构化归并与校验
- Consolidation Worker 自动领取任务，调用大模型分析候选词样本。
- 严格使用 Chat Completions JSON Schema 约束输出，确保返回的 `canonical_name`、`aliases`、`description` 和 `covered_ids` 具备 100% 格式合法性与候选词引用一致性。

### 3. AI 智能助审助手 (SSE 流式防超时截断)
- 在【审核中心】提供一键 `🤖 AI 智能助审` 评估。
- 后端建立 SSE 长通道 (`text/event-stream`)，瞬间完成 `<1ms` HTTP 200 握手响应，并启动 5 秒后台 Heartbeat Ping 线程，**彻底解决 Nginx 默认 60 秒超时报 504 Gateway Time-out 截断问题**。
- 前端集成暗色实时打字机推演面板与多维置信度筛选。

### 4. 别名独立回退与主标签级联逻辑归档 (`status = 'archived'`)
- 支持在**待审核 (`pending`)** 与 **已审核 (`approved`)** 提案中，针对单独别名点击 `↩️ 回退候选池`。
- 被回退的别名及其对应候选词条目在数据库中自动重置为未结算状态 (`resolved_at = NULL`)，**即刻重新释放重返候选池**。
- **主标签级联逻辑归档规则**：若某提案新建的主标签下所有别名均被回退（别名数量归零），系统自动将该主标签执行逻辑归档（`UPDATE tags SET status = 'archived'`），保留 100% 数据库历史可追溯性，且绝对不破坏数据完整性。

### 5. 第三方打标匹配 API (`/api/v1/tags/match`)
- 提供高并发第三方打标匹配接口，支持传入应用专属 API Key 鉴权 (`X-API-Key`)。
- 在【系统设置中心】与【API 开放接入】页面集成 Python、cURL、Node.js 全套 SDK 调用代码示例。

### 6. 卡片式悬浮 Dashboard 布局与 Dark Mode
- 全面采用“卡片式悬浮、四周留白”的现代 Dashboard 布局，四周保持 16px~20px 均匀留白与浅灰背景 (`#f4f5f7`)。
- 侧边栏与主视图均采用独立的 `rounded-2xl` 大圆角卡片，支持一键 `☀️ 明亮 / 🌙 暗色` 主题无缝切换与偏好持久化。

---

## ⚡ 本地快速启动

### 方式一：Docker Compose 一键启动 (推荐)

```bash
# 复制环境变量模板
cp .env.example .env

# 编辑 .env 文件，配置安全的 JWT_SECRET、PostgreSQL 密码和 LLM_* 大模型凭证

# 启动标准版容器服务:
docker compose up --build

# 国内极速镜像源加速版 (推荐国内网络使用，基于 docker.1ms.run 镜像源):
docker compose -f compose.accelerated.yaml up --build
```

- **管理控制台**: `http://localhost:4173`
- **后端 API 基地址**: `http://localhost:8080/api/v1`
- **默认管理员账号**: `admin@example.com` / `change-me-now` (首次启动后请立即在左侧栏底部修改密码)

---

### 方式二：本地手动分步开发

```bash
# 1. 启动 PostgreSQL 数据库，配置 DATABASE_URL 与 JWT_SECRET
# 2. 启动后端 API 与 Worker 进程
cd backend
go mod tidy
go run ./cmd/api

# 在第二个终端启动异步任务 Worker
go run ./cmd/worker

# 3. 启动前端 Vite 开发服务器
cd ../frontend
npm install
npm run dev
```

---

## 📋 环境变量对照表

| 环境变量 | 必需 | 说明与默认值 |
| --- | --- | --- |
| `DATABASE_URL` | 是 | PostgreSQL 数据库连接 DSN 地址 (格式: `postgres://user:pass@host:5432/dbname?sslmode=disable`) |
| `JWT_SECRET` | 是 | 用于身份令牌签名的密钥 (要求不少于 32 个字符) |
| `SEED_ADMIN_EMAIL` | 否 | 空数据库自动初始化的管理员邮箱 (默认: `admin@example.com`) |
| `SEED_ADMIN_PASSWORD` | 否 | 空数据库初始化的管理员密码 (默认: `change-me-now`) |
| `LLM_BASE_URL` | 否 | OpenAI-compatible API 基地址 (通常含 `/v1`，如 `https://api.openai.com/v1`) |
| `LLM_API_KEY` | 否 | 大模型服务商的 API 访问凭证 Key |
| `LLM_MODEL` | 否 | 调用的模型名称 (默认: `gpt-4o-mini` 或支持 Chat Completions 的其它模型) |
| `LLM_TIMEOUT_SECONDS` | 否 | 模型单次调用的超时秒数限制 (可在设置中心在线调整，范围 10-600s) |
| `LLM_MAX_RETRIES` | 否 | 任务失败时的最大重试上限 (可在设置中心在线调整，范围 1-10) |

---

## 🔌 第三方打标 API 调用示例 (Python)

```python
import requests

url = "http://localhost:8080/api/v1/tags/match"
headers = {
    "X-API-Key": "YOUR_APPLICATION_API_KEY",
    "Content-Type": "application/json"
}
payload = {
    "namespace": "default",
    "raw_tags": ["人工智能开发", "AIGC助手", "Python"]
}

response = requests.post(url, headers=headers, json=payload)
print(response.json())
```

---

## 🔒 运营与生产安全约束

1. **大模型凭证安全**: 模型 API Key 仅保留在后端环境变量或系统设置数据库中，**绝对不对外泄露至前端浏览器**，亦不写入审计日志。
2. **确定性精确隔离**: 标签命中采用规范化名称与别名确定性匹配，保证归并结果的高精度与可控性。
3. **高可用 Nginx 代理**: 生产环境部署时，建议使用项目自带的 `frontend/nginx.conf`，确保 SSE 流式响应代理缓冲已关闭 (`proxy_buffering off`) 且超时时间调大为 600 秒。
4. **数据追溯性**: 提案操作、决策更新、别名回退与主标签逻辑归档均记录完整的版本号 (`version`) 与 `audit_logs` 审计日志。

---

## 📄 开源许可证

本项目采用 [MIT License](LICENSE) 许可证。

