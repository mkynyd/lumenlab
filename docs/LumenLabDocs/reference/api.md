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

### `GET /api/user/api-keys`

- 描述：列出当前用户自行配置的 API Key（自托管模式下生效）。
- 认证：需登录。
- 响应：`[{ id, provider, keyMask, createdAt, ... }]`

### `POST /api/user/api-keys`

- 描述：保存或更新用户自行提供的 API Key。
- 认证：需登录。
- 请求：`{ provider, key }`
- 响应：保存后的 API Key 摘要信息。

### `POST /api/user/generate-profile`

- 描述：为当前用户生成新的凭证配置（CredentialProfile），用于分配新的模型额度或密钥组。
- 认证：需登录。
- 响应：包含新配置 ID 与状态信息。

### `POST /api/user/switch-code`

- 描述：切换当前用户绑定的注册码，用于更新所属密钥组或延长使用期限。
- 认证：需登录。
- 请求：`{ registrationCode }`
- 响应：切换后的注册码状态与用户信息。

---

## Chat

### `POST /api/chat`

- 描述：主聊天接口，支持 SSE 流式返回。根据配置选择 DeepSeek 或 MiniMax 模型，并执行检索、工具调用与 Agent 审批流程。
- 认证：需登录。
- 请求：`{ messages, conversationId?, projectId?, model?, options? }`
- 响应：`text/event-stream`，每条消息为一个 SSE 数据帧。

---

## Conversations

### `GET /api/conversations`

- 描述：获取当前用户的对话列表。
- 认证：需登录。
- 响应：`[{ id, title, updatedAt, projectId, ... }]`

### `POST /api/conversations`

- 描述：创建新对话。
- 认证：需登录。
- 请求：`{ title?, projectId? }`
- 响应：新创建的对话对象。

### `GET /api/conversations/[id]`

- 描述：获取指定对话详情与消息历史。
- 认证：需登录，且只能访问自己的对话。
- 响应：`{ id, title, messages: [...], ... }`

### `PATCH /api/conversations/[id]`

- 描述：更新对话标题或元数据。
- 认证：需登录。
- 请求：`{ title? }`
- 响应：更新后的对话对象。

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

### `POST /api/projects/[id]/quick-actions/generate`

- 描述：为项目生成推荐快捷任务。
- 认证：需登录。
- 请求：`{ context? }`
- 响应：生成的快捷任务列表。

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

- 描述：触发文件解析，支持 PDF / Office / 图片 / 文本等格式。MinerU Precision 用于高精度 PDF 解析。
- 认证：需登录。
- 响应：`{ id, status, parsedContent? }`

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

### `POST /api/artifacts/[id]/export`

- 描述：将 Artifact 导出为 Markdown、DOCX 或 PDF。
- 认证：需登录。
- 请求：`{ format: 'markdown' | 'docx' | 'pdf' }`
- 响应：导出后的下载链接或文件内容。

---

## Tools

### `POST /api/tools/pdf-to-markdown`

- 描述：将上传的 PDF 转换为 Markdown，使用 MinerU Precision 解析。
- 认证：需登录。
- 请求：`multipart/form-data` 或 `{ fileUrl }`
- 响应：`{ markdown, metadata }`

### `POST /api/tools/conversions/*`

- 描述：Office / WPS / iWork 文档转换入口，将文档转为 PDF 后再进入解析流程。
- 认证：需登录。
- 请求与响应：具体形状取决于转换类型，通常为异步任务 ID。

---

## Agent

### `POST /api/agent/approve`

- 描述：批准 Agent 提出的工具调用或文件操作。
- 认证：需登录。
- 请求：`{ requestId, params? }`
- 响应：操作执行结果。

### `POST /api/agent/reject`

- 描述：拒绝 Agent 提出的操作请求，AI 将继续后续步骤。
- 认证：需登录。
- 请求：`{ requestId }`
- 响应：`{ success: true }`

---

## Metrics / Health

### `GET /api/health`

- 描述：健康检查端点，返回应用运行状态。
- 认证：公开。
- 响应：`{ status: 'ok', version? }`

### `GET /api/metrics/cache`

- 描述：返回四层缓存的运行指标，用于性能观察与调试。
- 认证：需登录（管理员视角）或根据部署策略公开。
- 响应：`{ hits, misses, layers: [...] }`

---

## Internal

### `POST /api/internal/registration-sync`

- 描述：接收加密注册码快照，用于同步可用注册码与密钥组。快照采用 RSA-OAEP + AES-256-GCM + HMAC 签名，并校验时间戳与 nonce 防重放。
- 认证：通过同步密钥与签名校验，不依赖用户会话。
- 请求：加密快照载荷。
- 响应：同步成功或失败状态。
