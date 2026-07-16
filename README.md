# LumenLab

面向大学计算机课程的 AI 实验工作台。学生上传课件、实验数据、代码和笔记后，通过 Skill Router 与受控的 Agent 模式获得基于真实资料的 AI 回答，并把有价值的回答保存为可导出的成果。

![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![TypeScript 5](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)
![PostgreSQL + pgvector](https://img.shields.io/badge/PostgreSQL-16-pgvector?logo=postgresql)
![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react)

## 目录

- [项目简介](#项目简介)
- [核心特性](#核心特性)
- [技术栈](#技术栈)
- [项目结构](#项目结构)
- [架构设计](#架构设计)
- [快速开始](#快速开始)
- [使用指南](#使用指南)
- [部署](#部署)
- [贡献](#贡献)

## 项目简介

LumenLab 是一个面向大学生与学习者的 AI 学习平台，围绕"项目"组织课程资料、对话、Agent 任务和可导出成果。

- 通过 Skill Router 自动识别学习场景，在项目资料、论文、考试、代码和文档任务之间切换合适的 Skill。
- 通过受控的 Agent 模式让模型以 Skill 绑定 + Tool 调用的方式完成多步任务，所有副作用由服务端 Policy Engine 审批。
- 上传课件、PDF、Office 文档、图片、代码和笔记后，系统自动解析、分块、索引，并在回答底部展示来源。
- 把有长期价值的回答保存为 Artifact，并导出 Markdown、DOCX 或 PDF。

### 目标用户

需要整理课程资料、实验数据、代码和复习材料的大学生。用户通常在桌面端持续使用，需要快速切换项目上下文并保持工作区专注。

## 核心特性

### Skill Router 与任务画像

上传文件或输入问题后，系统通过 Skill Router 识别论文阅读、论文写作、考点分析、复习教练、代码阅读、文档处理、图表规范、AI 痕迹去除等学习场景。路由结果会决定当前 Skill、任务画像、是否建议联网，以及可使用的 Tool 范围。

### 项目化资料管理

- 按实验、复习、编程、通用四种类型创建项目，每个项目可配置独立的系统提示词和默认模型。
- 上传 PDF、Office/WPS/iWork 文档、图片、文本和代码文件，自动解析、分块、索引和知识增强。
- 在对话中勾选项目文件作为上下文，AI 回答基于真实资料。

### 受控 Agent 模式

入口处的 Skill Router 先识别用户意图，自动从 13 个内置 Skill 中选择一个激活；用户也可在 UI 手动切换 Skill 或关闭 Skill，手动选择优先级最高。后续统一进入 `AgentRuntime`：DeepSeek 使用 native `web.search` 并在其他工具上保留 adapter 内部 XML/DSML fallback，MiniMax 使用 native `tool_use`；两者共享同一套工具循环、Policy、审批、审计与结构化事件。

服务端 Policy Engine 拦截所有 `tool_use`，按 L0–L4 风险等级决定执行、预批准或逐次确认。

- L1 自动执行：项目资料读取、Artifact 列表、项目 RAG、网页/arXiv 只读检索、引用格式化、Skill 激活。
- L2 首次询问：保存 Artifact、新增或挂载参考文献。
- L3 每次询问：删除项目资料、导出 Artifact DOCX。
- Skill 只能收紧权限，不能放宽。
- 需要确认的工具通过一次性审批令牌（sha256 存储 + `argumentsHash` + user/conversation/tool/request 绑定）授权，模型或客户端在等待期间替换参数会被拒绝。
- 审批端点原子抢占待执行记录，恢复原项目上下文并真实执行 handler；成功或失败终态会直接回写 UI。拒绝只终结当前 `ToolExecution`，不会执行该工具。

### 内置 Skills

当前 Skill 包从 `.lumenlab/skills` 发现并注册，按学习场景分为 13 个内置 Skill：

| 分类 | Skill | 典型用途 | 风险上限 |
|------|-------|----------|----------|
| academic | paper-reader | 论文速读、精读、多论文对比 | L3 |
| academic | paper-writer | 论文初稿、报告结构、引用组织 | L2 |
| academic | literature-review | 文献综述、研究现状、方法对比 | L2 |
| academic | figure-style | 科学图表规范、图表反模式检查 | L2 |
| academic | humanizer-zh | 中文文本润色、去 AI 痕迹 | L2 |
| exam | exam-extract | 考点抽取、考试范围 triage | L2 |
| exam | exam-coach | 复习计划、速记卡、自测题 | L2 |
| coding | code-reader | 代码解释、结构分析、调用路径 | L2 |
| document | pdf | PDF 阅读、提取、整理 | L2 |
| document | docx | Word 文档草稿与结构化处理 | L3 |
| document | pptx | 课程展示、答辩、讲稿大纲 | L3 |
| document | xlsx | 表格设计、数据统计、公式说明 | L2 |
| learning | socratic-tutor | 苏格拉底式启发辅导 | L2 |

每个 Skill 由 `SKILL.md` 和 `policy.json` 组成，包含工具白名单、风险上限、默认审批策略、必需 scopes、输入输出契约、数据处理策略和触发词。

### 内置 Tools

| 风险 | Tool |
|------|------|
| L1 自动执行 | `project_files.list`、`project_files.read`、`artifact.list`、`project_rag.search`、`web.search`、`web.fetch`、`arxiv.search`、`arxiv.read`、`arxiv.fetch`、`reference.list`、`reference.format`、`skill.activate` |
| L2 首次询问 | `artifact.save`、`reference.add`、`reference.attach` |
| L3 每次询问 | `project_files.delete`、`artifact.export_docx` |

`web.search` 与 `web.fetch` 走 host 白名单与 SSRF 校验，IPv4、IPv6 和 IPv4-mapped IPv6 都会先排除非公网地址；`web.fetch` 的实际连接会固定到已验证 DNS 地址，每次重定向都重新解析与固定，阻断 DNS rebinding。抓取设置 8 秒超时和 1.5MB body 上限。项目与成果 Tool 还会检查持久化的 `User.scopes`，空权限集合按无权限处理，不会回退到默认全集。所有 Tool 在执行前都要做跨租户预检和参数校验，`artifact.save` 的 handler 会再次确认目标项目归属。待审批记录在 token 兑换前还会用当前 Tool/Skill、scope 与资源归属重新评估，防止审批等待期的权限撤销被绕过。

### SSE Agent 事件流

Agent 事件以 `event: agent` 行的形式注入到 `/api/chat` 的 SSE 流。

事件类型：

- `skill_activated` / `skill_suggested` / `skill_deactivated` — Skill 状态变化。
- `web_access_enabled` — 当前请求启用联网。
- `model_adapter_selected` — 当前使用的模型 provider（DeepSeek / MiniMax / Bailian Qwen）。
- `approval_required` — 等待用户授权。
- `tool_started` / `tool_completed` / `tool_failed` — 工具执行生命周期。

调试事件（`router_candidates`、`router_confidence`、`profile_changed`、`tool_loop_stop_reason` 等）仅在 `AGENT_DEBUG_EVENTS=1` 时发送，不默认入库。

前端 `AgentTimeline` 把事件流折叠成时间线，`ApprovalCard` 展示受影响资源、可逆性与样本，提供 **仅本次允许**、**本会话同类允许**（仅 L1/L2）、**拒绝** 三个动作。

来源统一在助手消息底部 UI 展示，模型正文不插引用。Agent Orchestrator 路径的 `web.fetch`、`project_files.read`、`project_rag.search`、`web.search`、`arxiv.read` 等结果，以及旧版 RAG 路径检索到的项目资料，都会聚合为 `Message.sources` 持久化并去重显示。

### 多模型流式对话

- 支持 DeepSeek V4 Pro / DeepSeek V4 Flash，深度推理模式可选。
- MiniMax M3 负责多模态对话、图片 OCR 与 PDF 原生文档解析。
- Qwen3.7-Plus 默认关闭，开启后可选；支持文本输出与图像/视频理解，由 DashScope 原生 `BailianQwenAdapter` 承接。
- Provider 协议层默认为项目自有 legacy adapter；`AGENT_PROVIDER_ADAPTER=pi` 可切换为 `@earendil-works/pi-ai` 隔离适配（仅 DeepSeek / MiniMax）。
- SSE 流式输出，Markdown / KaTeX / Mermaid / 代码高亮实时渲染。
- 集中式 API Key 管理：用户不需要自行申请 Key，由管理员通过注册码体系统一配置。

### 文档解析与转换

- 项目资料上传支持 PDF、Office/WPS/iWork 文档、图片、文本和代码文件，单次最多 50 个文件，单文件 50MB。
- 项目 PDF 与图片走 MiniMax M3；Office/WPS/iWork 文档走 MinerU 转 Markdown 并保存图片资源；文本和代码本地解析。
- 独立 `/tools` 文档转换继续使用 MinerU Precision，将 PDF 转为含公式、表格和图片的 Markdown。
- 在线预览完整渲染结果，下载含 Markdown、图片目录、样式 PDF 和 DOCX 的 ZIP 包，并可保存到项目资料。

### RAG 检索与资料图谱

- 三级检索策略按优先级：用户选中文件、项目索引匹配、关键词/全文检索、pgvector 向量检索。
- 向量检索使用阿里云百炼 `qwen3-vl-embedding` 1024 维嵌入；未配置或失败时自动降级为关键词检索。
- 项目侧边栏提供资料图谱，按 topic / file / chunk 展示项目资料关系，便于定位解析质量和知识结构。

### Artifact 成果库

- 对话中的优质回答可保存为 Artifact，支持 14 种成果类型。
- 一键导出 Markdown、DOCX、PDF，以 Markdown 为唯一源，AST 级转换保证格式一致。
- 导出结果通过 Redis 缓存，重复下载即时返回。

### 注册码与集中认证

- 用户注册需要提供邮箱、密码和有效注册码。
- 注册码由独立管理端 course-ai-regadmin 生成和发布。
- API Key 集中加密存储，用户无法查看明文。
- 同步协议使用 RSA-OAEP + AES-256-GCM + HMAC 防篡改和重放。

## 技术栈

| 类别 | 技术 |
|------|------|
| 框架 | Next.js 16.2 (App Router, Turbopack, Standalone 输出) |
| 语言 | TypeScript 5, React 19 |
| 数据库 | PostgreSQL 16 + pgvector 0.8 |
| ORM | Prisma 7.8 |
| AI 调用 | Anthropic SDK (兼容 DeepSeek / MiniMax Anthropic 接口) |
| 缓存 | Redis 7 + TanStack Query + React `cache()` |
| 认证 | NextAuth.js v5 (Credentials Provider, JWT) |
| 样式 | Tailwind CSS 4 |
| 虚拟化 | TanStack Virtual |
| 文件解析 | MiniMax M3, MinerU Precision, PDF.js, @napi-rs/canvas |
| 文档导出 | docx, sharp, Playwright/Chromium, pdfkit, unified/remark |
| 存储 | 七牛云 Kodo 私有对象存储 (生产), 本地文件系统 (开发降级) |
| 加密 | AES-256-GCM, bcrypt, RSA-OAEP, HMAC-SHA256 |
| 验证 | Zod 4 |
| 测试 | Vitest, Testing Library |

## 项目结构

```
src/
├── app/                                # Next.js App Router
│   ├── (auth)/                         # 登录、注册页面
│   │   ├── login/page.tsx
│   │   └── register/page.tsx
│   ├── (chat)/                         # 主应用壳层
│   │   ├── layout.tsx                  # 全局侧边栏布局
│   │   ├── chat/page.tsx               # 普通聊天
│   │   ├── chat/[id]/page.tsx          # 历史对话
│   │   ├── projects/page.tsx           # 项目列表
│   │   ├── projects/new/page.tsx       # 新建项目
│   │   ├── projects/[id]/page.tsx      # 项目工作台
│   │   ├── settings/page.tsx           # 用户设置
│   │   └── tools/page.tsx              # 文档工具
│   └── api/                            # REST API
│       ├── chat/                        # 薄 HTTP/SSE 适配层
│       │   ├── route.ts                # Auth、限流、错误映射与 Runtime 调用
│       │   ├── request-mapper.ts       # JSON/multipart → AgentRunInput
│       │   └── response-stream.ts      # AgentEvent → 兼容 SSE
│       ├── agent/
│       │   ├── approve/route.ts        # 一次性审批令牌兑换
│       │   └── reject/route.ts         # 显式拒绝待执行 ToolExecution
│       ├── auth/[...nextauth]/         # NextAuth 认证路由
│       ├── auth/register/              # 注册码注册
│       ├── projects/                   # 项目 CRUD
│       ├── conversations/              # 对话管理
│       ├── files/                      # 文件上传、解析、下载、增强
│       ├── artifacts/                  # 成果库 CRUD 与导出
│       ├── tools/                      # PDF 转换、图片导出
│       ├── internal/registration-sync/ # 管理端同步端点
│       ├── user/switch-code/           # 用户切换注册码
│       ├── health/                     # 健康检查
│       └── metrics/cache/              # 缓存指标
├── lib/
│   ├── deepseek.ts                     # DeepSeek API 客户端 (Anthropic SDK 流式)
│   ├── agent/                          # Agent 模式核心
│   │   ├── contracts.ts                # AgentRuntime / AgentRun 输入输出合同
│   │   ├── runtime.ts                  # 唯一 Runtime 编排入口
│   │   ├── runtime-events.ts           # 结构化 Runtime 事件
│   │   ├── runtime-mode.ts             # legacy / shadow / new 显式策略
│   │   ├── context/                    # 项目/文件归属与视觉上下文组装
│   │   ├── adapters/                   # Provider Adapter（legacy / Pi POC / Bailian Qwen）
│   │   ├── providers/                  # Provider delta/usage 规范化
│   │   ├── loop/agent-loop.ts          # 唯一模型工具循环
│   │   ├── tools/tool-runner.ts        # Policy/审批/执行/审计状态机
│   │   ├── persistence/                # Conversation / ToolExecution Adapter
│   │   ├── observability/              # shadow 决策差异
│   │   ├── types.ts                    # RiskLevel / ToolMetadata / SkillMetadata / ...
│   │   ├── tool-registry.ts            # 工具注册中心
│   │   ├── skill-registry.ts           # Skill 注册中心
│   │   ├── policy-engine.ts            # L0–L4 策略 + 范围 + 风险上限 + 参数校验
│   │   ├── approval-token.ts           # 一次性 sha256 令牌
│   │   ├── tool-executor.ts            # 处理器分发
│   │   ├── event-stream.ts             # AgentEvent ↔ SSE 序列化
│   │   ├── conversation-loop.ts        # agent-loop 兼容导出
│   │   ├── preview-builder.ts          # 脱敏 ToolCallPreview
│   │   └── audit-log.ts                # AgentAuditLog 写入器
│   ├── skills/                         # Skill discovery / migration / Provider-aware tools
│   │   ├── discovery.ts                # 从 .lumenlab/skills 读取 SKILL.md + policy.json
│   │   ├── migration.ts                # DiscoveredSkill → SkillMetadata
│   │   ├── registry.ts                 # 注册入口 + 旧 SkillDefinition 兼容层
│   │   └── executor.ts                 # legacy tool name 兼容层
│   ├── tools/                          # 内置 Tool 实现
│   │   ├── project-files/              # list / read / delete
│   │   ├── artifacts/                  # save / list
│   │   ├── web/                        # search / fetch (白名单 + 超时)
│   │   ├── knowledge/                  # project_rag.search
│   │   ├── shared/sanitize.ts          # 跨租户预检
│   │   └── registry.ts                 # Tool + handler 总装
│   ├── chat/
│   │   ├── router.ts                   # 文本/多模态分类 + 模型锁路由
│   │   ├── minimax-chat.ts             # MiniMax M3 流式客户端
│   │   └── project-conversation-state.ts
│   ├── vision/minimax.ts               # MiniMax M3 视觉 OCR
│   ├── rag/                            # 文档分块 + 关键词 + 向量 + 项目索引
│   ├── files/                          # 解析任务、M3 文档流水线
│   ├── parse/                          # MinerU 文本解析（独立 /tools 流程）
│   ├── export/                         # Markdown → DOCX / PDF / ZIP
│   ├── storage/object-storage.ts       # 七牛云 Kodo 对象存储
│   ├── registration-code.ts            # 注册码摘要与校验
│   ├── registration-sync.ts            # 同步载荷校验
│   ├── registration-sync-crypto.ts     # 同步加密 (RSA + AES + HMAC)
│   ├── provider-access.ts              # 集中式 API Key 解析
│   ├── crypto.ts                       # AES-256-GCM 加解密
│   ├── cache/                          # 缓存模块 (导出缓存、指标、实验)
│   ├── redis.ts                        # Redis 连接与健康检查
│   ├── db.ts                           # Prisma 客户端
│   ├── auth.ts / auth.config.ts        # NextAuth 配置
│   ├── hooks/                          # TanStack Query Hooks
│   ├── data/                           # 服务端数据访问层 (React cache)
│   └── validators.ts                   # Zod 校验
├── components/
│   ├── chat/                           # 聊天组件
│   │   ├── agent-timeline.tsx          # Agent 事件时间线
│   │   ├── approval-card.tsx           # 审批卡片
│   │   ├── tool-call-card.tsx          # 工具调用卡片
│   │   ├── skill-badge.tsx             # Skill 标签
│   │   ├── model-selector.tsx
│   │   └── ...
│   ├── project/                        # 项目组件 (侧边栏、文件上传、快捷任务)
│   ├── artifact/                       # 成果库组件
│   ├── settings/                       # 设置面板 (API Key、缓存指标)
│   ├── landing/                        # 匿名营销页 (LandingSurface)
│   ├── markdown/                       # 共享 Markdown / KaTeX / Mermaid 渲染
│   ├── tools/                          # PDF 转换客户端
│   ├── workbench/                      # 交互点阵背景 + Spotlight 卡片
│   └── layout/                         # 布局组件 (导航栏、侧边栏)
└── prisma/
    ├── schema.prisma                   # 数据模型
    └── migrations/                     # 数据库迁移

.lumenlab/
└── skills/                             # 内置 Agent Skill 包
    ├── academic/                       # paper-reader / paper-writer / literature-review / ...
    ├── coding/                         # code-reader
    ├── document/                       # pdf / docx / pptx / xlsx
    ├── exam/                           # exam-extract / exam-coach
    └── learning/                       # socratic-tutor
```

## 架构设计

### 核心数据流

普通聊天：

```
用户输入 → /api/chat HTTP Adapter（Auth / 限流 / 请求映射）
         → AgentRuntime.run(AgentRunInput)
         → ContextAssembler + ConversationPersistence
         → Skill Router / RAG / 确定性 prelude
         → ProviderAdapter（legacy：DeepSeek native + XML fallback / MiniMax native；可选 Pi 隔离适配；Qwen 走 DashScope 原生）
         → Agent Loop（规范化调用、Policy、ToolRunner、continuation）
         → 结构化 AgentEvent
         → SSE Adapter（保持既有 data/event 格式与响应头）
         → 前端实时渲染 Markdown / 来源 / 时间线
         → ConversationPersistence 异步完成 Message
         → 可选保存为 Artifact → 导出 MD/DOCX/PDF
```

Agent 聊天：

```
Runtime prelude 规划工具，或 ProviderAdapter 规范化模型 tool_use
  → AgentEvent: tool_proposed
  → policy-engine 校验：风险等级 + Skill 白名单 + 范围 + 参数 + 会话预批准
  ├─ blocked    → AgentEvent: tool_blocked
  ├─ L1 auto    → tool-executor 执行
  ├─ L2 session → 检查会话预批准，否则进入 L3 路径
  └─ L3/L4 ask  → AgentEvent: approval_required
                 → 用户通过 approval-card 触发 /api/agent/approve
                 → approval-token 兑换（sha256 + argumentsHash + 绑定校验）
                 → 原子 claim → 恢复执行上下文 → tool-executor 执行
  → AgentEvent: tool_started / tool_progress / tool_completed / tool_failed
  → audit-log 写入 AgentAuditLog
```

`AGENT_RUNTIME_MODE` 在开发和生产中使用同一默认值 `legacy`。`shadow` 只比较 Skill、联网和预规划工具等无副作用决策并记录结构化差异；`new` 启用 Runtime-owned Skill 状态与确定性 prelude。旧 `AGENT_ORCHESTRATOR_ENABLED=0/1` 仅作为未配置新变量时的兼容桥。

### 四层缓存

| 层 | 实现 | 策略 |
|---|------|------|
| 客户端状态 | TanStack Query | 30s stale, 5min GC, 精确失效 |
| 请求去重 | React `cache()` 数据层 | 单次 request 内 DB 查询去重 |
| 应用缓存 | Redis + 内存降级 | 滑动窗口限流, 导出缓存 1h TTL |
| 外部 API | DeepSeek KV + MiniMax Prompt Cache | 实验开关默认关闭 |

### Agent 数据模型

| 模型 | 用途 |
|------|------|
| `User.scopes` | 当前用户可授予 Agent 的精确权限集合；新用户默认拥有 project/artifact 的 read/write，持久化空数组表示全部撤销。 |
| `SkillPackage` | 声明式 Skill 包（skillId + version, 允许工具, 风险上限, 必需 scopes, 契约, 数据处理策略）。`(skillId, version)` 唯一。 |
| `ConversationSkill` | 单次对话中的 Skill 激活日志。 |
| `ToolDefinition` | 声明式 Tool 包（风险等级, 副作用标记, 默认审批模式, 审计级别, 允许的 Skill ID）。 |
| `ToolExecution` | 每次 tool_use 一行：标准化参数、sha256 `argumentsHash`、状态、审批快照、scope、执行上下文、时间戳、结果/错误摘要；一次性令牌哈希单独保存在绑定的 `ApprovalToken`。 |
| `ApprovalToken` | 一次性审批令牌，只存 sha256；消费时重新校验 `argumentsHash`，阻止参数替换攻击。 |
| `AgentAuditLog` | `tool_proposed` / `tool_blocked` / `approval_required` / `approval_granted` / `tool_started` / `tool_completed` / `tool_failed` / `user_rejected` / `token_consumed` 等事件。 |
| `UserToolPreference` | 用户级 Tool 审批覆盖（L3/L4 不能存为 `auto`）。 |

### 安全模型

```
请求 → NextAuth JWT 中间件 (proxy.ts)
     → 路由层 userId 归属校验
     → 数据层 projectId / conversationId 关联校验
     → Agent 层 User.scopes + policy-engine 拦截 + 一次性审批令牌
     → 密码 bcrypt 哈希, API Key AES-256-GCM 加密（16-byte auth tag）
     → 同步协议: RSA-OAEP + AES-256-GCM（16-byte auth tag）+ HMAC + nonce 防重放
```

## 快速开始

### 前提条件

- Node.js 20+
- PostgreSQL 16 + pgvector
- Redis 7
- course-ai-regadmin 管理端发布的注册码与密钥组

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

需要配置的核心变量：

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | PostgreSQL 连接串 |
| `REDIS_URL` | Redis 连接串（可选，离线时降级至内存） |
| `AUTH_SECRET` | 生成命令: `openssl rand -base64 32` |
| `ENCRYPTION_KEY` | 64 位 hex, 生成命令: `openssl rand -hex 32` |
| `REGISTRATION_CODE_PEPPER` | 注册码加盐, 与 regadmin 的 FINGERPRINT_SECRET 独立 |
| `REGISTRATION_SYNC_SECRET` | 与 course-ai-regadmin 共享的同步密钥 |
| `REGISTRATION_SYNC_PRIVATE_KEY_BASE64` | RSA 私钥 (PEM base64) |
| `AGENT_RUNTIME_MODE` | `legacy` / `shadow` / `new`，默认 `legacy` |
| `QINIU_ACCESS_KEY` / `QINIU_SECRET_KEY` | 七牛云 Kodo 密钥（生产必填） |
| `QINIU_BUCKET` | Kodo 空间名 |
| `AUTH_URL` | 生产环境: `https://lab.mkynstudio.top` |

### 3. 初始化数据库

```bash
npx prisma migrate deploy
```

### 4. 启动开发服务器

```bash
npm run dev
```

打开 `http://localhost:3000`，使用邮箱、密码和有效注册码创建账户。

## 使用指南

### 创建项目

1. 点击侧边栏「新建项目」。
2. 选择项目类型（实验、复习、编程、通用）。
3. 可选设置默认模型和系统提示词。

### 上传资料

1. 进入项目，在侧边栏上传文件（PNG、JPEG、WebP、PDF、Office/WPS/iWork、TXT、MD、CSV、代码等）。
2. 图片与 PDF 使用 MiniMax M3 解析；Office/WPS/iWork 文档使用 MinerU 解析并保存图片资源；文本与代码本地读取。
3. 单次最多 50 个文件，单文件上限 50MB，总大小上限 300MB。
4. 可选对解析结果进行知识增强。

### 开始对话

1. 在项目聊天区输入问题，或选择快捷任务。
2. 勾选「选择文件」指定对话上下文。
3. 可选启用深度推理模式获得慢思考。
4. AI 回答基于项目资料，不确定内容标注 `[需补充]`。

### 使用 Agent 模式

1. Skill Router 会在 13 个内置 Skill 中自动选择合适能力；用户也可手动切换或关闭 Skill。
2. 模型需要调用 Tool 时，Agent 事件流会把工具调用以时间线方式展示在对话中。
3. L3 Tool（如 `project_files.delete`）会在执行前弹出审批卡片，展示受影响资源、可逆性与样本。
4. 选择「仅本次允许」会立即兑换一次性审批令牌；选择「本会话同类允许」会预批准该 Skill 的同类 L1/L2 Tool。

### 保存成果

1. 满意的回答可保存为 Artifact（14 种成果类型）。
2. 成果库中可导出为 Markdown、DOCX 或 PDF。

### 转换 PDF 文档

1. 侧边栏进入「文档」，上传 PDF。
2. 等待 MinerU 逐页解析，在线预览公式、表格和图片。
3. 下载完整 ZIP 包，或保存到项目作为资料。

## 部署

### 生产环境

项目已在 `lab.mkynstudio.top` 生产运行。架构如下：

```
用户 → Nginx (HTTPS, 宝塔管理)
     → 127.0.0.1:3000 (Next.js standalone, systemd `lumenlab.service`)
     → PostgreSQL 16 + Redis 7 (本地环回)
     → 七牛云 Kodo (文件存储)
     → course-ai-regadmin (注册码同步, regadmin.mkynstudio.top)
```

服务器采用 release 目录布局，共享数据与运行版本分离：

```
/www/wwwroot/course-ai-lab/
├── .env                  # 共享环境变量（不随发布变更）
├── uploads/              # 共享持久数据
├── .lumenlab/            # 共享应用数据
├── releases/<commit>/    # 各版本的 standalone 运行单元
├── current -> releases/<commit>
└── build/                # 临时构建树
```

### 发布与回滚

```bash
# 部署指定 commit（默认 origin/main HEAD）：CI 门禁、构建、3002 预检、原子切换、健康检查
./scripts/deploy.sh deploy <commit>

# 回滚到上一个 release
./scripts/deploy.sh rollback

# 查看当前发布状态
./scripts/deploy.sh status
```

部署脚本通过 SSH 在服务器上构建，目标 commit 的 GitHub Actions CI 必须为绿（无 CI 记录的历史 commit 可显式 `--skip-ci-check`）。服务器仅保留当前与上一个 release；数据库迁移前自动 `pg_dump` 快照（保留最近 3 份）。

### CI 门禁

push 到 `main` 触发 `.github/workflows/ci.yml`：Linux 全量验证（`npm ci`、Prisma generate、lint、tsc、测试、migrate、build、lockfile 不可变检查）加 macOS lockfile 一致性检查。

### Nginx 配置要点

- 反向代理到 `127.0.0.1:3000`。
- SSE 流式输出需关闭代理缓冲：`proxy_buffering off`。
- 上传限制匹配 `experimental.proxyClientMaxBodySize`。
- 静态资源 `/_next/static` 由 Nginx 直接提供，路径固定指向 `current/.next/static`，发布无需改动 Nginx。

### 数据库迁移

迁移由 `scripts/deploy.sh` 自动执行（`npx prisma migrate deploy`，迁移前自动快照）。手动检查：

```bash
npx prisma migrate status
```

## 贡献

### 开发约定

- `npm test` 运行测试 (Vitest)。
- `npm run lint` 代码风格检查。
- 遵循项目现有的代码组织模式。
- API Key 等敏感信息禁止硬编码。
- 新增 Agent Tool / Skill 时在 `src/lib/tools/registry.ts` 或 `src/lib/skills/registry.ts` 中注册，并补齐对应的 `*manifest.ts` 与测试。

### 相关项目

- [course-ai-regadmin](https://github.com/mkynyd/course-ai-regadmin) — 注册码管理后台，负责注册码生成、密钥组管理和发布同步。

[MIT](LICENSE)
