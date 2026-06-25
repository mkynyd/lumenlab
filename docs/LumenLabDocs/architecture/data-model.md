# 数据模型

> 面向开发者与自托管维护者，介绍 LumenLab 的核心实体、关系与关键约束。

## 数据库

PostgreSQL + pgvector 扩展。向量字段使用 1024 维（`vector(1024)`），对应阿里云百炼 text-embedding-v4。

ORM 使用 Prisma 7，客户端生成到 `src/generated/prisma/client`。

## 核心实体关系

### 用户与项目

- `User` 拥有多个 `Project`、`Conversation`、`FileAsset`、`Artifact`。
- `Project` 聚合了一个工作单元的所有内容：文件、对话、成果、快捷任务与项目索引。
- `ProjectIndex` 用于缓存项目级上下文摘要（与 `Project` 一对一）。

### 对话与消息

- `Conversation` 属于 `User`，可属于某个 `Project`。
- `Message` 属于 `Conversation`，记录 `role`（user / assistant / system）、内容、reasoning content、token 使用与缓存命中信息。
- `Artifact` 可关联到 `Conversation` / `Message`，也可直接归属 `Project`。

### 文件与 RAG

- `FileAsset` 归属 `User` 与 `Project`（可选），保存上传文件元数据、解析文本与存储路径。
- `DocumentChunk` 归属 `User` / `Project` / `FileAsset`，保存文本切片及其 `vector(1024)` 嵌入。
- `FileAssetResource` 与 `DocumentConversionAsset` 用于多文件打包资源的子文件管理。

### 文档转换

- `DocumentConversion` 记录一次 PDF / Office 文档转换任务的结果。
- `DocumentConversionAsset` 保存转换产物中的图片等子资源。

### 引用文献

- `Reference` 保存文献元数据（DOI、arXiv ID、作者、年份等）。
- `ReferenceListItem` 把文献挂到具体 `Artifact` 上，并记录显示顺序。

### Agent 与审批

- `SkillPackage` 存储可安装的 Skill 元数据，包括允许调用的 Tool 列表与风险上限。
- `ToolDefinition` 是 Tool 的静态注册信息，包含输入输出 schema、风险等级、默认审批模式。
- `ToolExecution` 记录一次具体的工具调用生命周期（proposed → pending_approval → executing → succeeded / failed）。
- `ApprovalToken` 是一次性审批令牌，绑定到 user、conversation、tool 与参数哈希。
- `AgentAuditLog` 记录工具与 Skill 相关事件，用于审计。
- `UserToolPreference` 保存用户对单个 Tool 的审批偏好。

## API Key 与凭证模型

### ApiKey（自托管模式）

- 用户级密钥表，字段 `provider` 与 `encryptedKey`。
- 关键约束：`@@unique([userId, provider])`，即每个用户对每个 provider 只能保存一条密钥。
- 适合自托管场景，用户自行维护模型密钥。

### CredentialProfile / ProviderCredential（中央凭证模式）

- `CredentialProfile` 是一组 provider 凭证的集合；`User.credentialProfileId` 指向它。
- `ProviderCredential` 保存单个 provider 的加密切片，约束为 `@@unique([credentialProfileId, provider])`。
- 适合管理员集中配置，用户无需自行设置 API Key。

### RegistrationCode / RegistrationRedemption

- `RegistrationCode` 保存注册码摘要、状态、最大可兑换次数与已兑换次数。
- `RegistrationRedemption` 记录哪个 `User` 兑换了哪个 `RegistrationCode`，`userId` 全局唯一，即一个用户只能绑定一次兑换记录。

## 关键字段说明

| 字段 | 说明 |
|---|---|
| `Conversation.modelLock` | 当对话因多模态附件被锁定到 MiniMax 时，后续消息继续使用该 provider。 |
| `FileAsset.enhancementStatus` | 文本增强状态：none / enhancing / enhanced / stale / failed。 |
| `FileAsset.processingMetadata` | JSON，记录 OCR、图片保留数量等解析元数据。 |
| `Message.cacheHitTokens` / `cacheMissTokens` | 外部 API 提示缓存命中 / 未命中 token 数。 |
| `Message.provider` | 实际响应该消息的模型 provider。 |
| `ToolExecution.argumentsHash` | 参数 canonical JSON 的 sha256，用于审批前后防篡改。 |

## 索引速查

主要索引已针对高频查询设计：

- `User.email`、`User.credentialProfileId`
- `ApiKey.userId`
- `Conversation.userId`、`Conversation.projectId`
- `Message.conversationId`
- `Project.userId`
- `FileAsset.userId`、`FileAsset.projectId`、`FileAsset.status`
- `DocumentChunk.userId`、`DocumentChunk.projectId`、`DocumentChunk.fileAssetId`
- `ToolExecution.conversationId`、`ToolExecution.userId` + `status`
- `ApprovalToken.tokenHash`
