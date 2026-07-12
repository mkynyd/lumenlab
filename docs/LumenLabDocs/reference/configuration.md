# 配置与环境变量

> 本文档面向开发者与自托管用户，列出运行 LumenLab 所需的环境变量。配置项主要来源于 `.env.example` 与 `src/lib/config.ts`。

---

## 核心变量表

| 变量名 | 是否必需 | 默认值 / 示例 | 用途 |
|---|---|---|---|
| `DATABASE_URL` | 必需 | `postgresql://postgres:postgres@localhost:5432/ai_workspace?schema=public` | PostgreSQL 连接串，需启用 `pgvector` 扩展 |
| `REDIS_URL` | 可选 | `redis://localhost:6379` | 共享缓存与限流存储；不可用时回退到内存 |
| `AUTH_SECRET` | 必需 | `please-change-this` | Auth.js v5 会话签名密钥，建议用 `openssl rand -base64 32` 生成 |
| `AUTH_URL` | 必需 | `https://lab.mkynstudio.top` | 认证回调地址，需与最终访问域名一致 |
| `ENCRYPTION_KEY` | 必需 | `please-generate-a-64-char-hex-string` | AES-256-GCM 加密密钥，需 64 位十六进制字符；用 `openssl rand -hex 32` 生成 |
| `REGISTRATION_CODE_PEPPER` | 必需 | — | Alpha 注册码哈希胡椒值，与管理端使用同一值 |
| `REGISTRATION_SYNC_SECRET` | 必需 | — | 注册码同步请求校验密钥，与管理端使用同一值 |
| `REGISTRATION_SYNC_PRIVATE_KEY_BASE64` | 必需 | — | Base64 编码的 RSA 私钥 PEM，用于解密注册码同步快照 |
| `DEEPSEEK_BASE_URL` | 必需 | `https://api.deepseek.com` | DeepSeek API 基础地址 |
| `QINIU_ACCESS_KEY` | 必需 | — | 七牛云 Access Key |
| `QINIU_SECRET_KEY` | 必需 | — | 七牛云 Secret Key，仅服务端使用 |
| `QINIU_BUCKET` | 必需 | `course-ai-lab` | 七牛云存储空间名 |
| `QINIU_REGION` | 必需 | `z2` | 七牛云存储区域 |
| `QINIU_UPLOAD_HOST` | 必需 | `https://up-z2.qiniup.com` | 七牛云上传域名 |
| `QINIU_PRIVATE_DOMAIN` | 必需 | `coursecdn.mkynstudio.top` | 七牛云私有下载域名 |
| `NEXT_PUBLIC_APP_NAME` | 必需 | `LumenLab` | 前端展示的应用名称 |
| `USER_API_KEYS_ENABLED` | 可选 | `false` | 自托管开关；设为 `1` 或 `true` 时优先读取用户自行配置的 API Key |
| `AGENT_RUNTIME_MODE` | 可选 | `legacy` | Agent Runtime 发布模式：`legacy` / `shadow` / `new` |
| `AGENT_ORCHESTRATOR_ENABLED` | 已弃用 | — | 仅在未设置 `AGENT_RUNTIME_MODE` 时兼容旧部署：`0` → `legacy`，`1` → `new` |
| `AGENT_DEBUG_EVENTS` | 可选 | `false` | 是否在 SSE 中发送 router/debug 事件 |
| `WEB_FETCH_ALLOWLIST` | 可选 | — | 允许 `web.fetch` 抓取的域名列表，建议生产环境显式配置 |
| `CACHE_EXPERIMENT_PROMPT_REORDER` | 可选 | `false` | 是否启用提示词重排实验 |
| `CACHE_EXPERIMENT_REORDER_STRATEGY` | 可选 | `rag-to-last-user` | 提示词重排策略 |
| `CACHE_EXPERIMENT_MINIMAX_ACTIVE` | 可选 | `false` | 是否启用 MiniMax 模型缓存实验 |

---

## 补充说明

### 密钥生成

- `AUTH_SECRET`：至少 32 字节，建议 `openssl rand -base64 32`。
- `ENCRYPTION_KEY`：固定 64 字符十六进制，对应 32 字节，建议 `openssl rand -hex 32`。
- `REGISTRATION_CODE_PEPPER` 与 `REGISTRATION_SYNC_SECRET`：各自独立生成，长度建议不低于 48 字节，例如 `openssl rand -base64 48`。
- `REGISTRATION_SYNC_PRIVATE_KEY_BASE64`：将 RSA 私钥 PEM 文件进行 Base64 编码后填入。

### 数据库

`DATABASE_URL` 指向的 PostgreSQL 实例必须安装并启用 `pgvector` 扩展，用于向量检索与 RRF 融合。

### Redis

`REDIS_URL` 为可选项。未配置或连接失败时，应用会使用内存作为降级缓存与限流存储；多实例部署时建议配置 Redis。

### 自托管模式

`src/lib/config.ts` 中的 `USER_API_KEYS_ENABLED` 控制部署模式：

- 默认 `false`：使用 `CredentialProfile` 中的中央密钥组（Alpha 注册码流程）。
- 设为 `1` 或 `true`：优先读取 `ApiKey` 表中用户自行提供的 API Key，未找到时回退到中央密钥组。

该开关没有前端 UI，需由部署者通过环境变量控制。

支持的 provider 包括 `deepseek`、`minimax`、`mineru`、`bailian`。项目资料中的 PDF/图片解析依赖 MiniMax，Office/WPS/iWork 解析依赖 MinerU，向量检索依赖 Bailian；缺失对应密钥时，相关能力会报错或降级。

### Agent 与联网

- `AGENT_RUNTIME_MODE=legacy` 是固定默认值，保持兼容响应，不启用确定性工具前奏。
- `AGENT_RUNTIME_MODE=shadow` 仍返回 legacy 结果，只比较 Skill、联网与计划 Tool ID 并记录日志；不会为候选方案额外调用 Provider 或执行 Tool，因此没有重复费用和副作用。
- `AGENT_RUNTIME_MODE=new` 启用确定性工具前奏、Skill 状态事件与统一 Tool loop。Provider continuation 由 Adapter 根据原生 Tool block 或 DeepSeek XML/DSML fallback 自动处理，不再需要独立 continuation 开关。
- 旧变量 `AGENT_ORCHESTRATOR_ENABLED` 只用于迁移兼容；两者同时存在时 `AGENT_RUNTIME_MODE` 优先。新部署不要再配置旧变量。
- `AGENT_DEBUG_EVENTS=1` 会把 router candidates、confidence、stop reason 等调试事件写入 SSE，生产环境默认关闭。
- `WEB_FETCH_ALLOWLIST` 控制 `web.fetch` 可抓取的域名。即使域名在 allowlist 中，服务端仍会做公开 URL、DNS、重定向和 SSRF 校验。

### 缓存实验开关

`CACHE_EXPERIMENT_*` 系列变量用于逐步验证缓存优化效果。建议在收集基线指标前保持默认关闭状态。
