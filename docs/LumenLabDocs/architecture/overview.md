# 架构总览

> 面向开发者与自托管维护者，介绍 LumenLab 的整体架构、请求流转与核心目录。

## 技术栈

LumenLab 是一个基于 Next.js 16 App Router 的在线 AI 学习工作台：

- **前端框架**：Next.js 16 App Router、React 19、TypeScript、Tailwind CSS 4
- **数据库**：PostgreSQL + pgvector，使用 Prisma 7 作为 ORM
- **缓存**：Redis 可选；Redis 不可用时核心功能会降级到内存或数据库
- **AI 调用**：DeepSeek（对话 / 推理）、MiniMax（多模态与文档解析）、阿里云百炼（RAG 嵌入与可选 Qwen3.7-Plus 聊天）
- **Provider 层**：项目自有 DeepSeek / MiniMax / Bailian Qwen Adapter；DeepSeek / MiniMax 可切换到隔离的 `pi-ai` POC
- **部署**：生产使用 Next.js standalone + systemd + Nginx，PostgreSQL / Redis 绑定本机环回；本地依赖也可用 Docker Compose 启动

## 应用路由结构

| 路由分组 | 路径示例 | 说明 |
|---|---|---|
| `(auth)` | `/login`、`/register` | 登录、注册、注册码校验 |
| `(chat)` | `/chat`、`/chat/[id]`、`/projects`、`/tools`、`/tools/[id]` | 工作台：对话、项目、资料、快捷任务 |
| `/docs` | `/docs` | 静态文档站点 |
| `/api/*` | `/api/chat`、`/api/agent/*`、`/api/skills/catalog` | 服务端 API |

## 核心目录

```
src/
├── app/api/                  # Next.js API Routes（HTTP 鉴权、限流、请求/响应适配）
│   └── chat/                 # 薄聊天 Route、请求映射器与 SSE 响应适配器
├── components/chat/          # 聊天界面、消息卡片、附件、工具审批 UI
├── components/project/       # 项目详情、文件列表、快捷任务、成果库
├── lib/chat/                 # 模型路由、历史压缩
├── lib/rag/                  # 向量检索、全文检索、关键词检索、embedding
├── lib/agent/                # 与 HTTP 无关的 Agent Runtime 模块化单体
│   ├── runtime.ts            # AgentRuntime.run(input) 唯一业务编排入口
│   ├── context/              # ContextAssembler：项目与选中文件所有权校验
│   ├── adapters/             # ProviderAdapter：厂商协议、Tool 映射与 continuation
│   ├── loop/                 # AgentLoop：统一多轮工具循环、去重与停止条件
│   ├── tools/                # ToolRunner：Policy、审批、执行、审计状态机
│   ├── persistence/          # 对话与 ToolExecution 的 Prisma 适配器
│   ├── providers/            # 上游流标准化为内部 ProviderStreamEvent
│   ├── observability/        # shadow 模式的无副作用规划比较
│   ├── orchestrator.ts       # new 模式的确定性工具前奏规划
│   ├── skill-router.ts       # Skill 意图路由与任务画像推断
│   └── sources.ts            # AgentSource 聚合与持久化
├── lib/skills/               # .lumenlab/skills discovery、metadata migration、legacy compat
├── lib/tools/                # project files / artifact / web / arxiv / reference / export tools
├── lib/files/                # 项目文件上传解析、MiniMax PDF/图片、MinerU Office
├── lib/cache/                # 应用级缓存、导出缓存、实验开关、缓存指标
├── lib/export/               # Markdown / DOCX / PDF 导出与格式转换
└── lib/storage/              # 本地存储与七牛云对象存储抽象
```

## 典型请求流

以一次普通聊天请求为例，数据从浏览器到模型再回到客户端的完整路径如下。HTTP 层只负责协议适配，业务编排统一从 `AgentRuntime.run(input)` 进入：

```
浏览器
  │  POST /api/chat  (SSE)
  ▼
src/app/api/chat/route.ts
  ├─ auth() 身份验证
  ├─ checkRateLimit() 用户级速率限制
  ├─ parseChatRequest() 解析并校验 JSON / multipart 与附件
  ├─ mapAgentRunInput() 映射为框架无关的 AgentRunInput
  ▼
AgentRuntime.run(input)
  ├─ ContextAssembler 校验项目、文件与用户边界
  ├─ Skill Router、系统提示词、检索上下文与模型路由
  ├─ ProviderAdapter.startRound() 统一 DeepSeek / MiniMax / Bailian Qwen 首轮调用
  ├─ new 模式可先运行确定性工具前奏
  ├─ AgentLoop 处理规范化 Tool call、去重、轮次与停止条件
  │        └─ ToolRunner 统一执行 Policy → 审批 → handler → audit → persistence
  ├─ ProviderAdapter.continueRound() 构造厂商正确的后续轮 transcript
  ├─ ConversationPersistence 创建并异步完成 assistant Message
  └─ 返回 AgentRun（metadata、内部事件流、completion）
  ▼
response-stream.ts
  ├─ 把内部事件转换为既有 OpenAI-compatible SSE 与 event: agent
  ├─ 保留 X-Conversation-Id / X-Message-Id / X-Model-Provider
  └─ 浏览器 useChat 按原协议消费
```

`AgentRuntime` 不依赖 `NextRequest`、`NextResponse` 或 SSE 文本格式，Provider 特有的工具名、原生 block、XML/DSML fallback 与 continuation transcript 也只存在于 `ProviderAdapter` 边界内。DeepSeek / MiniMax 默认使用项目自有 Adapter，也可通过 `AGENT_PROVIDER_ADAPTER=pi` 切到隔离 POC；Qwen 始终由 `BailianQwenAdapter` 承接。来源由 `src/lib/agent/sources.ts` 聚合去重，并通过 `ConversationPersistence` 写入同一条 `Message.sources` JSON 字段，前端来源展示协议保持不变。

## Runtime 发布模式

`AGENT_RUNTIME_MODE` 控制迁移阶段，默认值固定为 `legacy`：

| 模式 | 行为 |
|---|---|
| `legacy` | 保持兼容路径与现有用户可见响应，不启用确定性工具前奏 |
| `shadow` | 仍以 legacy 响应为准；只比较 Skill、联网与工具规划决策并写日志，不发起额外模型调用、不执行候选工具 |
| `new` | 启用 Runtime 的确定性工具前奏、Skill 状态事件与统一 Tool loop |

三种模式共用相同的薄 Route、`AgentRuntime` 接口、Provider/SSE 适配边界和持久化合同。`AGENT_ORCHESTRATOR_ENABLED` 仅保留为旧部署的兼容映射，新的部署应使用 `AGENT_RUNTIME_MODE`。

## 部署模式与 API Key

系统支持两种 API Key 获取方式，由 `src/lib/config.ts` 中的 `USER_API_KEYS_ENABLED` 控制：

- **中央凭证模式**（默认）：每个 `User` 关联到一个 `CredentialProfile`，由 `ProviderCredential` 表集中保存各模型加密切片。适合管理员统一分发、用户无感知使用。
- **自托管模式**：开启 `USER_API_KEYS_ENABLED=1` 后，系统优先读取 `ApiKey` 表中该用户对应 provider 的密钥；未找到再回退中央凭证。自托管用户可通过 `POST /api/user/api-keys` 自行维护密钥，也可使用 `scripts/setup-api-key.ts` 初始化。

用户如需更换当前激活的注册码（即切换到另一组中央凭证），可调用 `POST /api/user/switch-code`。

## 文件解析流水线

项目资料解析集中在 `src/lib/files/parse-job.ts`：

| 文件类型 | 解析路径 |
|---|---|
| 文本、Markdown、CSV、代码 | 本地读取 UTF-8 文本 |
| 图片 | MiniMax M3 视觉 OCR |
| PDF | MiniMax M3 原生文档解析 |
| Office / WPS / iWork | MinerU 解析 Markdown，图片保存为 `FileAssetResource` |

解析完成后会刷新 `ProjectIndex`，创建 `DocumentChunk`，并在可用时通过百炼 `qwen3-vl-embedding` 生成 1024 维向量。

## Skill 与 Tool 注册

运行时从 `.lumenlab/skills` 发现 Skill 包，读取每个 `SKILL.md` 和 `policy.json` 并转换为 `SkillMetadata`。Tool 元数据和 handler 在 `src/lib/tools/registry.ts` 注册，`PolicyEngine` 会在执行前统一检查 Skill allowlist、风险上限、scope、所有权和参数。

## 与其他文档的关联

- 模型如何选择：见 [任务路由](./task-router.md)
- Agent 审批与风险等级：见 [Policy Engine](./policy-engine.md)
- 缓存分层与指标：见 [缓存架构](./cache.md)
- 数据库表关系：见 [数据模型](./data-model.md)
