# 架构总览

> 面向开发者与自托管维护者，介绍 LumenLab 的整体架构、请求流转与核心目录。

## 技术栈

LumenLab 是一个基于 Next.js 16 App Router 的在线 AI 学习工作台：

- **前端框架**：Next.js 16 App Router、React 19、TypeScript、Tailwind CSS 4
- **数据库**：PostgreSQL + pgvector，使用 Prisma 7 作为 ORM
- **缓存**：Redis 可选；Redis 不可用时核心功能会降级到内存或数据库
- **AI 调用**：DeepSeek（对话 / 推理）、MiniMax（多模态）、阿里云百炼（RAG 嵌入）
- **部署**：Docker Compose（PostgreSQL + Redis）或单容器 + 外部数据库

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
├── app/api/                  # Next.js API Routes（聊天、Agent、上传、导出、用户设置）
├── components/chat/          # 聊天界面、消息卡片、附件、工具审批 UI
├── components/project/       # 项目详情、文件列表、快捷任务、成果库
├── lib/chat/                 # 模型路由、历史压缩
├── lib/rag/                  # 向量检索、全文检索、关键词检索、embedding
├── lib/agent/                # Policy Engine、Tool 注册与执行、审批 token、事件流
│   ├── orchestrator.ts       # 确定性预取工具规划与执行
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

以一次普通聊天请求为例，数据从浏览器到模型再回到客户端的完整路径如下：

```
浏览器
  │  POST /api/chat  (SSE)
  ▼
src/app/api/chat/route.ts
  ├─ auth() 身份验证
  ├─ checkRateLimit() 用户级速率限制
  ├─ parseRequest() 解析消息与附件
  ├─ 项目 / 文件权限校验
  ├─ routeSkill() Skill Router 选择 Skill、推断任务画像
  ├─ assembleSystemPrompt() 组装系统提示词
  ├─ retrieveProjectContext() RAG / 全文 / 关键词检索项目资料
  │        └─ 旧版 RAG sources 同步转换为 AgentSource 备用
  ├─ routeModel() 选择 DeepSeek 或 MiniMax
  ├─ getProviderApiKey() 获取 API Key（中央凭证或用户自托管 Key）
  ├─ Agent Orchestrator 预取与续跑
  │        ├─ buildPlannedToolCalls() 根据画像生成确定性工具计划
  │        ├─ executePlannedToolCalls() 执行并聚合 AgentSource
  │        └─ AGENT_CONTINUATION_ENABLED=1 时启用模型驱动多轮工具续跑
  ├─ DeepSeek / MiniMax Anthropic-compatible stream 发起 SSE 流
  │        ├─ 模型返回流式 token
  │        ├─ DeepSeek 路径可触发服务端 Tool 审批 / 执行
  │        └─ token 使用、缓存命中信息回传
  ├─ 创建 assistant Message 行，sources 写入 Message.sources
  └─ accumulateAndSave() 异步保存内容与来源到 PostgreSQL
```

来源持久化由 `src/lib/agent/sources.ts` 统一处理。Agent Orchestrator 执行工具和续跑循环产生的 `AgentSource` 会聚合去重；当 Agent Orchestrator 关闭时，旧版 RAG 检索结果也会转换为 `AgentSource` 并写入同一条 `Message.sources` JSON 字段，保证前端来源展示接口一致。

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
