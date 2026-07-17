# API 参考

> 本文档面向开发者，列出 LumenLab 主要 API 路由。路由均为 Next.js App Router 下的 Route Handlers，路径前缀 `/api` 省略。

---

## Auth

### `GET /api/auth/[...nextauth]`

- 描述：Auth.js v5 认证端点，处理登录、登出、会话刷新与 OAuth 回调。
- 认证：无需预先认证。
- 形状：遵循 Auth.js 标准协议；请求体与响应由 NextAuth 内部处理。

### `POST /api/auth/register`

- 描述：Alpha 注册码注册，创建新用户并建立默认凭证配置。
- 认证：公开。
- 请求：`{ email, password, registrationCode }`
- 响应：注册成功返回用户信息；失败返回对应错误码与提示。

---

## User

### `GET /api/user/profile`

- 描述：读取当前用户资料、昵称、头像 URL、profile prompt 等设置。
- 认证：需登录。
- 响应：当前用户资料对象。

### `PATCH /api/user/profile`

- 描述：更新当前用户昵称或 AI profile prompt。
- 认证：需登录。
- 请求：`{ name?, profilePrompt? }`
- 响应：更新后的用户资料。

### `POST /api/user/profile/avatar`

- 描述：上传当前用户头像，生产环境通过七牛云私有对象存储保存，开发环境可回退到本地存储。
- 认证：需登录。
- 请求：`multipart/form-data`
- 响应：更新后的头像 URL。

### `GET /api/user/profile/avatar`

- 描述：读取当前用户头像。七牛存储返回短期签名重定向，本地存储返回图片流。
- 认证：需登录，且只能读取自己的头像。

### `POST /api/user/api-keys`

- 描述：保存或更新用户自行提供的 API Key。
- 认证：需登录。
- 请求：`{ provider, apiKey }`，其中 provider 为 `deepseek`、`minimax`、`mineru` 或 `bailian`。
- 响应：`{ provider, keyPrefix }`。仅在 `USER_API_KEYS_ENABLED=1|true` 时开放。

### `POST /api/user/generate-profile`

- 描述：根据昵称、职业和补充信息调用 DeepSeek 生成个性化 `profilePrompt`，并写入当前用户资料。
- 认证：需登录。
- 请求：`{ nickname?, profession?, details? }`
- 响应：`{ profilePrompt }`

### `GET /api/me/usage`

- 描述：读取当前用户 token 与成本统计。
- 认证：需登录。
- 响应：按 provider、时间和项目聚合的使用数据。

### `POST /api/user/switch-code`

- 描述：切换当前用户绑定的注册码，用于更新所属密钥组或延长使用期限。
- 认证：需登录。
- 请求：`{ registrationCode }`
- 响应：切换后的注册码状态与用户信息。

---

## Chat

### `GET /api/chat/models`

- 描述：返回当前部署和当前账号实际可用的聊天模型。Qwen 只有在灰度开关、百炼工作空间和用户凭据都可用时才会出现。
- 认证：需登录。
- 响应：`{ models: ['deepseek-v4-pro', 'deepseek-v4-flash', 'minimax-m3', 'qwen3.7-plus'?] }`

### `POST /api/chat`

- 描述：主聊天接口。薄 Route 完成鉴权、限流和 JSON / multipart 解析后，把框架无关输入交给 `AgentRuntime.run()`；Runtime 负责上下文、模型、ProviderAdapter、Tool loop 与持久化，最后由 SSE adapter 恢复既有聊天协议。
- 认证：需登录。
- JSON 请求：`{ message, model, conversationId?, projectId?, hiddenPrompt?, selectedFileIds?, mode?, thinkingEnabled?, reasoningEffort?, webSearchActive?, manualSkillId?, skillOff?, isQuickTask?, materialScope? }`。
- multipart 请求：`message` 字段放置上述 JSON 字符串，`attachments` 字段可重复提交文件。
- 响应：`text/event-stream`。模型增量保持 OpenAI-compatible `data:` 帧；Agent 状态使用 `event: agent`；结束帧为 `data: [DONE]`。
- 响应头：`X-Conversation-Id`、`X-Message-Id`、`X-Model-Provider`、`X-Agent-Runtime-Version`、`X-Agent-Tool-Protocol`；兼容头 `X-Agent-Orchestrator` 在 `new` 模式为 `enabled`。

### `POST /api/chat/compact`

- 描述：对长对话进行上下文压缩，减少后续模型输入体积。
- 认证：需登录。
- 请求：`{ conversationId }`
- 响应：压缩结果摘要。

---

## Conversations

### `GET /api/conversations`

- 描述：获取当前用户的对话列表。
- 认证：需登录。
- 响应：`{ conversations: [{ id, title, model, modelLock, thinkingEnabled, updatedAt }] }`，这里只列出普通聊天（`projectId = null`）。

### `GET /api/conversations/[id]`

- 描述：获取指定对话详情与消息历史。
- 认证：需登录，且只能访问自己的对话。
- 响应：`{ conversation: { id, title, messages: [...], ... } }`

### `DELETE /api/conversations/[id]`

- 描述：删除对话及其消息。
- 认证：需登录。
- 响应：`{ success: true }`

---

## Projects

### `GET /api/projects`

- 描述：获取当前用户的项目列表。
- 认证：需登录。
- 响应：`[{ id, name, description, updatedAt, ... }]`

### `POST /api/projects`

- 描述：创建新项目。
- 认证：需登录。
- 请求：`{ name, description? }`
- 响应：新创建的项目对象。

### `GET /api/projects/[id]`

- 描述：获取指定项目详情。
- 认证：需登录，且只能访问自己的项目。
- 响应：`{ id, name, description, files, artifacts, ... }`

### `PATCH /api/projects/[id]`

- 描述：更新项目信息。
- 认证：需登录。
- 请求：`{ name?, description? }`
- 响应：更新后的项目对象。

### `DELETE /api/projects/[id]`

- 描述：删除项目及其关联文件、成果。
- 认证：需登录。
- 响应：`{ success: true }`

### `GET /api/projects/[id]/files`

- 描述：获取项目下的文件列表。
- 认证：需登录。
- 响应：`[{ id, name, status, type, ... }]`

### `POST /api/projects/[id]/files`

- 描述：向项目上传或关联文件。
- 认证：需登录。
- 请求：通常为 `multipart/form-data`。
- 响应：上传后的文件对象。

### `GET /api/projects/[id]/artifacts`

- 描述：获取项目下的 Artifact 成果列表。
- 认证：需登录。
- 响应：`[{ id, title, type, createdAt, ... }]`

### `POST /api/projects/[id]/artifacts`

- 描述：在项目下创建新 Artifact。
- 认证：需登录。
- 请求：`{ title, content, type? }`
- 响应：新创建的 Artifact 对象。

### `GET /api/projects/[id]/quick-actions`

- 描述：获取项目的快捷任务列表。
- 认证：需登录。
- 响应：快捷任务数组。

### `POST /api/projects/[id]/generate-prompt`

- 描述：根据项目类型和资料生成或更新项目提示词。
- 认证：需登录。
- 请求：`{ context? }`
- 响应：生成的提示词内容。

### `GET /api/projects/[id]/vector-library`

- 描述：返回项目资料图谱数据，包含 topic / file / chunk 节点和关系边。
- 认证：需登录。
- 响应：`{ nodes, links, stats }`

---

## Files

### `GET /api/files/[id]`

- 描述：获取文件元数据。
- 认证：需登录，且文件需属于当前用户。
- 响应：`{ id, name, status, type, projectId, ... }`

### `PATCH /api/files/[id]`

- 描述：更新文件元数据，例如重命名或修改状态。
- 认证：需登录。
- 请求：`{ name?, status?, ... }`
- 响应：更新后的文件对象。

### `DELETE /api/files/[id]`

- 描述：删除文件及其远端存储对象。
- 认证：需登录。
- 响应：`{ success: true }`

### `POST /api/files/[id]/parse`

- 描述：触发文件解析，支持 PDF / Office / WPS / iWork / 图片 / 文本 / 代码等格式。项目 PDF 与图片走 MiniMax M3；Office/WPS/iWork 走 MinerU；文本和代码本地读取。
- 认证：需登录。
- 响应：`{ id, status, parsedContent? }`

### `GET /api/files/[id]/resources/[resourceId]`

- 描述：读取文件解析过程中保存的私有图片资源。
- 认证：需登录，且资源需属于当前用户文件。
- 响应：图片二进制流。

### `GET /api/files/[id]/download`

- 描述：获取私有文件下载链接，返回七牛云私有签名 URL。
- 认证：需登录。
- 响应：`{ url, expiresAt }`

### `POST /api/files/[id]/enhance`

- 描述：对文件解析结果进行增强处理，例如 OCR 补全或分段优化。
- 认证：需登录。
- 响应：增强后的文件内容摘要。

---

## Artifacts

### `GET /api/artifacts/[id]`

- 描述：获取单个 Artifact 详情。
- 认证：需登录，且 Artifact 需属于当前用户。
- 响应：`{ id, title, content, type, projectId, ... }`

### `PATCH /api/artifacts/[id]`

- 描述：更新 Artifact 标题或内容。
- 认证：需登录。
- 请求：`{ title?, content?, type? }`
- 响应：更新后的 Artifact 对象。

### `DELETE /api/artifacts/[id]`

- 描述：删除 Artifact。
- 认证：需登录。
- 响应：`{ success: true }`

### `GET /api/artifacts/[id]/export?format=markdown|docx|pdf`

- 描述：将 Artifact 导出为 Markdown、DOCX 或 PDF。
- 认证：需登录。
- 响应：直接返回下载文件，并通过 `X-Cache: HIT|MISS` 标识 Redis 导出缓存状态。

---

## Tools

### `POST /api/tools/pdf-to-markdown`

- 描述：将上传的 PDF 转换为 Markdown，使用 MinerU Precision 解析。
- 认证：需登录。
- 请求：`multipart/form-data`，字段为 `file`，可选一次性 `mineruToken`；单文件上限 200MB。
- 响应：`text/event-stream`，逐步返回上传、模型解析、完成或失败事件；完成事件包含 `conversionId`、Markdown、元数据与图片资源列表。

### `/api/tools/conversions/*`

- 描述：文档转换记录、图片资源、完整包下载和保存到项目的入口。列表与详情使用 GET，单条记录支持 DELETE，下载与资源使用 GET，保存到项目使用 POST。
- 认证：需登录。
- 请求与响应：具体形状取决于转换类型，通常为异步任务 ID。

---

## Skills

### `GET /api/skills/catalog`

- 描述：返回当前 `.lumenlab/skills` 发现到的 Skill catalog，包括分类、显示名、描述、触发词和策略摘要。
- 认证：需登录。
- 响应：`{ categories, skills }`

---

## Agent

### `POST /api/agent/approve`

- 描述：校验待审批执行的归属与状态，使用落库的规范化参数消费一次性 token，然后立即调用统一 Tool handler 并落为成功或失败终态。
- 认证：需登录。
- 请求：`{ executionId, token, scope?: 'once' | 'session' }`。L3 / L4 仅允许 `once`。
- 成功响应：`{ ok: true, status: 'succeeded', scope, executionId, resultSummary }`。
- 执行失败响应：`{ ok: false, status: 'failed', scope, executionId, error }`。审批成功后的执行结果会成为前端 Timeline 终态，但不会自动恢复此前暂停的 Provider continuation。

### `POST /api/agent/reject`

- 描述：拒绝一次 `pending_approval` ToolExecution，落库为 `rejected` 并写入审计；不会自动恢复暂停的 Provider continuation。
- 认证：需登录。
- 请求：`{ executionId, reason? }`
- 响应：`{ ok: true, executionId }`。

---

## Metrics / Health

### `GET /api/health`

- 描述：健康检查端点，返回应用运行状态。
- 认证：公开。
- 响应：`{ status: 'healthy' | 'degraded' | 'unhealthy', timestamp, checks: { database, redis } }`。数据库失败返回 503；仅 Redis 失败时返回 200 + `degraded`。

### `GET /api/metrics/cache`

- 描述：返回四层缓存的运行指标，用于性能观察与调试。
- 认证：需登录，只返回当前用户的 token/cache 统计与全局导出、RAG 缓存摘要。
- 查询：`days=1..90`，或 `range=cycle`，也可传 `start` / `end`。
- 响应：包含总体、每日、provider、project、tokenUsage、exports 与 rag 指标。

---

## Internal

### `POST /api/internal/registration-sync`

- 描述：接收加密注册码快照，用于同步可用注册码与密钥组。快照采用 RSA-OAEP + AES-256-GCM + HMAC 签名，并校验时间戳与 nonce 防重放。
- 认证：通过同步密钥与签名校验，不依赖用户会话。
- 请求：加密快照载荷。
- 响应：同步成功或失败状态。
