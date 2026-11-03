# API 参考

> 本文档面向开发者，列出 LumenLab 主要 API 路由。路由均为 Next.js App Router 下的 Route Handlers，路径前缀 `/api` 省略。

---

## Auth

### `GET /api/auth/[...nextauth]`

- 描述：Auth.js v5 认证端点，处理登录、登出、会话刷新与 OAuth 回调。
- 认证：无需预先认证。
- 形状：遵循 Auth.js 标准协议；请求体与响应由 NextAuth 内部处理。

### `POST /api/auth/register`

- 描述：创建新用户。注册凭证是邮箱验证挑战签发的一次性票据（ticket），必须先完成邮箱验证；新用户自动关联默认 `CredentialProfile`。
- 认证：公开。
- 请求：`{ email, password, ticket }`
- 响应：注册成功（201）返回用户信息；失败返回对应错误码与提示（400 票据无效/过期、409 邮箱已注册、429 限流、503 默认凭证不可用）。

### `POST /api/auth/verify/send`

- 描述：为注册邮箱创建验证挑战并发送双通道邮件（6 位验证码 + 一次性链接）。
- 认证：公开（按 IP 限流）。

### `POST /api/auth/verify/code`

- 描述：校验 6 位验证码，签发一次性注册 ticket。
- 认证：公开。
- 请求：`{ email, code }`
- 响应：`{ success, ticket }`

### `GET /api/auth/verify/link`

- 描述：一次性链接验证，成功后重定向到 `/register?verified=1&ticket=...` 直达设置密码步骤。
- 认证：公开。

### `POST /api/auth/password/forgot`

- 描述：发起密码重置，发送重置邮件；无论邮箱是否存在都返回成功，防止账号枚举。
- 认证：公开（按 IP 限流）。

### `GET /api/auth/password/reset-link`

- 描述：校验重置链接有效性（不消费令牌），随后由前端引导到 `/reset-password?ticket=...`。
- 认证：公开。

### `POST /api/auth/password/reset`

- 描述：原子消费重置令牌并更新密码，写入 `passwordChangedAt` 使旧会话失效。
- 认证：公开。
- 请求：`{ ticket, password }`

---

## User

### `GET /api/user/profile`

- 描述：读取当前用户资料、昵称、头像 URL、profile prompt 等设置。
- 认证：需登录。
- 响应：当前用户资料对象。

### `PATCH /api/user/profile`

- 描述：更新当前用户昵称或头像预设。
- 认证：需登录。
- 请求：`{ name?, avatarPreset? }`
- 响应：更新后的用户资料。

### `GET /api/user/persona`

- 描述：读取个性化 AI 画像输入与已生成的提示词，供设置的「个性化」页使用。
- 认证：需登录。
- 响应：`{ profileName, profileProfession, profileDetails, profilePrompt }`

### `PUT /api/user/persona`

- 描述：保存个性化 AI 画像的三个输入字段（空字符串归一化为 null）。
- 认证：需登录。
- 请求：`{ profileName?, profileProfession?, profileDetails? }`
- 响应：保存后的画像字段与 `profilePrompt`。

### `POST /api/user/password`

- 描述：已登录用户修改密码（设置的「账号安全」页）；校验当前密码，按 IP 限流，写入 `passwordChangedAt` 使旧会话失效。
- 认证：需登录。
- 请求：`{ currentPassword, newPassword }`

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
- 请求：`{ code }`
- 响应：`{ success: true }`；注册码无效、停用、过期或次数用完返回 400。

---

## Chat

### `GET /api/chat/models`

- 描述：返回当前部署和当前账号实际可用的聊天模型。Qwen 只有在灰度开关、百炼工作空间和用户凭据都可用时才会出现。
- 认证：需登录。
- 响应：`{ models: ['qwen3.8-flash'?, 'deepseek-flash', 'minimax-m3.1'], defaultModel, unavailableReasons }`；`models` 只包含活跃模型，历史模型 ID 只出现在历史消息与账单中。

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

- 描述：触发文件解析，支持 PDF / Office / WPS / iWork / 图片 / 文本 / 代码等格式。项目 PDF 走 MiniMax M3.1（超过 20MB 或请求被拒时回退 MinerU）；Office/WPS/iWork 走 MinerU；文本和代码本地读取；图片标记 `direct-image`，在聊天时交给所选模型。
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
- 响应：`{ categories, totalCount }`。`categories` 按 `.lumenlab/skills/INDEX.md` 的分类顺序排列（academic / exam / coding / learning / document，未分类归入 uncategorized 兜底），`totalCount` 为 Skill 总数。

---

## Agent

### `POST /api/agent/approve`（历史兼容）

- 恢复当前用户自己的 `pending_approval` 工具执行，重新检查原始参数、当前权限和归属，再原子领取并执行。
- 请求为 `{ executionId, token?, scope?: 'once' | 'session' }`。历史非持久父任务要求 token；持久父任务按已保存的执行关系恢复。L3 / L4 只允许 `once`。
- 成功响应包含 `{ ok: true, status: 'succeeded', scope, executionId, resultSummary }`。失败返回执行状态及错误。持久父任务恢复队列；非持久路径用 `shouldContinue` 指示客户端继续生成。
- 新工具调用通过 Policy 校验后自动执行，聊天加载历史等待任务时才使用此兼容路径。

### `POST /api/agent/reject`（历史兼容）

- 拒绝自己的 `pending_approval` 执行，写入终态与审计，并按父任务状态处理恢复。
- 请求为 `{ executionId, reason? }`，响应包含 `{ ok: true, executionId }`。两项兼容接口均要求登录。

### `GET /api/agent/executions/*`

- 描述：持久化 Agent 运行的状态查询、有序事件回放（支持 cursor 续传）、取消与重试，全部按归属限定为当前用户。仅在 `AGENT_DURABLE_EXECUTION_ENABLED=true` 时可用。
- 认证：需登录。

---

## Study

当前学习工作区使用 `/api/study/*`。所有接口要求登录，题集、错题本、素材、任务和日程按用户归属校验。以下路径相对于 `/api/study`。

| 方法 | 路径 | 合同概要 |
|---|---|---|
| GET / POST | `/collections` | 列出题集；创建题集与第一本错题本 |
| POST | `/collections/[id]/notebooks` | 在自己的题集中新建错题本 |
| GET | `/notebooks/[id]/items` | 列出错题本题目 |
| GET / PATCH | `/items/[id]` | 获取题目详情；修订题面并重新提交处理 |
| POST | `/imports` | multipart `file` 导入临时预览，原件30MB、最多80页 |
| GET | `/imports/[id]/pages/[page]` | 读取当前用户的临时预览页 |
| POST | `/imports/[id]/selection` | 提交选中区域，保存完整题目所需裁片并创建后台任务 |
| DELETE | `/imports/[id]` | 取消导入并清除临时预览 |
| POST | `/text-selection` | 收录选中的精确 Markdown 子串 |
| GET | `/items/[id]/assets/[asset]` | 读取题目关联素材，重新校验归属 |
| GET | `/jobs`、`/jobs/[id]` | 列出未完成任务或查询指定任务阶段、进度与失败原因 |
| POST | `/jobs/[id]` | 重试符合条件的失败任务 |
| GET | `/bank/papers`、`/bank/papers/[id]` | 查询人工核验发布的题库和试卷 |
| POST | `/bank/select` | 将选中的题库题目收录到自己的错题本 |
| GET | `/bank/questions/[id]/assets/[asset]` | 读取已核验发布题目的插图 |
| GET / POST | `/tasks` | 列出任务或新建带截止时间与预计工作量的任务 |
| PATCH | `/tasks/[id]` | 更新任务，包括完成或恢复状态 |
| GET / POST | `/events` | 列出日程或添加课程、学习与忙碌时段 |
| PATCH / DELETE | `/events/[id]` | 更新或移除自己的日程 |
| GET | `/preferences` | 读取时区、学期起点、节次与空闲时段偏好 |
| POST | `/timetable/preview` | 解析 Excel、ICS、图片或 PDF 课表，返回待确认内容 |
| POST | `/timetable/apply` | 保存确认后的课程与节次规则 |
| POST | `/extract` | 从大纲或老师要求提取待确认内容 |
| POST / PUT | `/planning` | 根据空闲时段预览规划；带版本确认后保存。预览过期或任务变化返回冲突 |
| POST | `/assistant` | 使用当前学习上下文进行讨论，无修改工具 |

题目解析通过 `StudyJob` 独立 Worker 执行。临时预览在提交、取消或过期后清除，长期只保存所选题目和必要素材。模型核验失败或证据不完整保留待校对状态。

旧 `/api/learning/*` 和 `/api/projects/[id]/learning/*` 已退役，旧学习记录由迁移清除。运行依赖、题库发布和清理说明见[部署](../deployment.md#学习扫描与文档导出依赖)。

---

## Feedback / Errors

### `POST /api/feedback`

- 描述：提交用户反馈（分类 bug / suggestion / other，内容 1–2000 字，可选联系方式），每用户每日 20 条。
- 认证：需登录。

### `POST /api/errors/report`

- 描述：客户端错误静默上报（zod 校验，按 IP 限流 30 次/分钟），始终返回 204。
- 认证：公开。

### `/api/admin/feedback/*` 与 `/api/admin/errors/*`

- 描述：管理端的反馈与错误事件列表、状态流转接口；仅 `ADMIN_EMAILS` 中的账号可用，非管理员一律返回 404。
- 认证：需登录且为管理员。

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
