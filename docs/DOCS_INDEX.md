# 文档索引

本目录包含 LumenLab 项目的技术文档、第三方服务 API 参考、设计规划与开发记录。以下按分类列出与项目直接相关的重点文档。

---

## 项目核心文档（根目录）

这些是项目的一级文档，定义了产品方向、架构设计和开发规范：

| 文档 | 说明 |
|---|---|
| [../README.md](../README.md) | 项目主文档 — 简介、架构、快速开始、部署 |
| [../PRODUCT.md](../PRODUCT.md) | 产品定义 — 目标用户、品牌人格、设计原则、Skill 图标规范 |
| [../DESIGN.md](../DESIGN.md) | 设计规范 — 动效原则、Landing 页例外规则 |
| [../IMPLEMENTATION.md](../IMPLEMENTATION.md) | 实现细节记录 |
| [../PROJECT_SUMMARY.md](../PROJECT_SUMMARY.md) | 项目总览与演进历史 |
| [../REPOSITORY_INDEX.md](../REPOSITORY_INDEX.md) | 仓库结构索引 — 文件树、数据模型、核心架构（每次开发前必读） |
| [../AGENTS.md](../AGENTS.md) | Agent 行为约束 — Git 流程、UI 设计语言、开发规范 |
| [../SKILLS.md](../SKILLS.md) | Skill 系统说明 |

---

## LumenLab 应用文档

LumenLab 自身的使用指南、架构说明和 API 参考：

| 文档 | 说明 |
|---|---|
| [LumenLabDocs/README.md](LumenLabDocs/README.md) | LumenLab 文档入口 |
| [LumenLabDocs/overview.md](LumenLabDocs/overview.md) | 产品概览 |
| [LumenLabDocs/getting-started.md](LumenLabDocs/getting-started.md) | 快速入门指南 |
| [LumenLabDocs/deployment.md](LumenLabDocs/deployment.md) | 部署指南 |
| [LumenLabDocs/faq.md](LumenLabDocs/faq.md) | 常见问题 |

### 架构

| 文档 | 说明 |
|---|---|
| [LumenLabDocs/architecture/overview.md](LumenLabDocs/architecture/overview.md) | 架构总览 |
| [LumenLabDocs/architecture/cache.md](LumenLabDocs/architecture/cache.md) | 缓存层设计 |
| [LumenLabDocs/architecture/data-model.md](LumenLabDocs/architecture/data-model.md) | 数据模型 |
| [LumenLabDocs/architecture/policy-engine.md](LumenLabDocs/architecture/policy-engine.md) | 策略引擎 |
| [LumenLabDocs/architecture/task-router.md](LumenLabDocs/architecture/task-router.md) | 任务路由 |

### 使用指南

| 文档 | 说明 |
|---|---|
| [LumenLabDocs/guides/agent-mode.md](LumenLabDocs/guides/agent-mode.md) | Agent 模式使用 |
| [LumenLabDocs/guides/artifacts.md](LumenLabDocs/guides/artifacts.md) | Artifacts 成果管理 |
| [LumenLabDocs/guides/files-and-rag.md](LumenLabDocs/guides/files-and-rag.md) | 文件上传与 RAG |
| [LumenLabDocs/guides/projects.md](LumenLabDocs/guides/projects.md) | 项目管理 |
| [LumenLabDocs/guides/skills-and-tools.md](LumenLabDocs/guides/skills-and-tools.md) | Skill 与工具 |

### 参考

| 文档 | 说明 |
|---|---|
| [LumenLabDocs/reference/api.md](LumenLabDocs/reference/api.md) | API 参考 |
| [LumenLabDocs/reference/configuration.md](LumenLabDocs/reference/configuration.md) | 配置项说明 |
| [LumenLabDocs/reference/error-codes.md](LumenLabDocs/reference/error-codes.md) | 错误码参考 |

---

## 设计规划与开发记录

`superpowers/` 目录保存项目的设计规划（plans）、设计规格（specs）和验证截图（verification）：

### 当前活跃的规划

| 文档 | 日期 | 说明 |
|---|---|---|
| [superpowers/plans/2026-07-06-multimodal-document-pipeline.md](superpowers/plans/2026-07-06-multimodal-document-pipeline.md) | 2026-07-06 | 多模态文档处理流水线 |
| [superpowers/plans/2026-07-06-document-pipeline-iterations-4-6.md](superpowers/plans/2026-07-06-document-pipeline-iterations-4-6.md) | 2026-07-06 | 文档流水线第 4-6 轮迭代 |
| [superpowers/specs/2026-07-06-multimodal-document-pipeline-design.md](superpowers/specs/2026-07-06-multimodal-document-pipeline-design.md) | 2026-07-06 | 多模态文档流水线设计规格 |
| [superpowers/specs/2026-07-06-document-pipeline-iterations-4-6-design.md](superpowers/specs/2026-07-06-document-pipeline-iterations-4-6-design.md) | 2026-07-06 | 文档流水线迭代设计规格 |

### 近期规划（2026-06）

| 文档 | 日期 | 说明 |
|---|---|---|
| [superpowers/plans/2026-06-30-project-chat-quick-task-rag-layout-plan.md](superpowers/plans/2026-06-30-project-chat-quick-task-rag-layout-plan.md) | 2026-06-30 | 项目聊天快捷任务与 RAG 布局 |
| [superpowers/specs/2026-06-30-project-chat-quick-task-rag-layout-design.md](superpowers/specs/2026-06-30-project-chat-quick-task-rag-layout-design.md) | 2026-06-30 | 项目聊天布局设计规格 |
| [superpowers/plans/2026-06-29-rag-cache-layer.md](superpowers/plans/2026-06-29-rag-cache-layer.md) | 2026-06-29 | RAG 缓存层设计 |
| [superpowers/plans/2026-06-28-qwen3-vl-embedding-replacement-plan.md](superpowers/plans/2026-06-28-qwen3-vl-embedding-replacement-plan.md) | 2026-06-28 | Qwen3-VL Embedding 替换方案 |
| [superpowers/specs/2026-06-28-qwen3-vl-embedding-replacement-design.md](superpowers/specs/2026-06-28-qwen3-vl-embedding-replacement-design.md) | 2026-06-28 | Qwen3-VL Embedding 替换设计规格 |
| [superpowers/plans/2026-06-21-project-workspace-color-polish.md](superpowers/plans/2026-06-21-project-workspace-color-polish.md) | 2026-06-21 | 项目工作区色彩打磨 |
| [superpowers/plans/2026-06-20-token-usage-metrics.md](superpowers/plans/2026-06-20-token-usage-metrics.md) | 2026-06-20 | Token 用量统计 |
| [superpowers/specs/2026-06-20-token-usage-metrics-design.md](superpowers/specs/2026-06-20-token-usage-metrics-design.md) | 2026-06-20 | Token 用量统计设计规格 |
| [superpowers/plans/2026-06-20-pdf-markdown-image-package.md](superpowers/plans/2026-06-20-pdf-markdown-image-package.md) | 2026-06-20 | PDF/Markdown/Image 打包方案 |
| [superpowers/specs/2026-06-20-pdf-markdown-image-package-design.md](superpowers/specs/2026-06-20-pdf-markdown-image-package-design.md) | 2026-06-20 | PDF 打包设计规格 |
| [superpowers/plans/2026-06-15-cache-architecture.md](superpowers/plans/2026-06-15-cache-architecture.md) | 2026-06-15 | 缓存架构设计 |
| [superpowers/specs/2026-06-15-alpha-registration-design.md](superpowers/specs/2026-06-15-alpha-registration-design.md) | 2026-06-15 | Alpha 注册设计规格 |

---

## 项目技术笔记

根级 docs 下的独立文档，记录特定技术话题：

| 文档 | 说明 |
|---|---|
| [TODO.md](TODO.md) | 项目待办事项汇总 |
| [token-usage-context-budget-compression.md](token-usage-context-budget-compression.md) | Token 用量、上下文预算与压缩策略分析 |
| [agent-orchestrator-diff.md](agent-orchestrator-diff.md) | Agent 编排器的变更记录 |
| [artifact-export.md](artifact-export.md) | Artifact 导出功能说明 |
| [database-postgresql-pgvector.md](database-postgresql-pgvector.md) | PostgreSQL + pgvector 数据库配置 |

---

## 第三方服务 API 参考

项目对接的外部服务文档，按服务商分类。这些是爬取的官方 API 文档副本，供开发时查阅。

### DeepSeek（AI 模型服务）

| 文档 | 说明 |
|---|---|
| [DeepSeek/deepseek-api-overview.md](DeepSeek/deepseek-api-overview.md) | API 总览 |
| [DeepSeek/deepseek-chat-completions.md](DeepSeek/deepseek-chat-completions.md) | Chat Completions 接口 |
| [DeepSeek/deepseek-models-pricing.md](DeepSeek/deepseek-models-pricing.md) | 模型列表与定价 |
| [DeepSeek/deepseek-tool-calls.md](DeepSeek/deepseek-tool-calls.md) | Tool Calls 工具调用 |
| [DeepSeek/deepseek-thinking-mode.md](DeepSeek/deepseek-thinking-mode.md) | 思考模式（DeepSeek-R1） |
| [DeepSeek/deepseek-token-usage.md](DeepSeek/deepseek-token-usage.md) | Token 用量说明 |
| [DeepSeek/deepseek-json-mode.md](DeepSeek/deepseek-json-mode.md) | JSON 模式 |
| [DeepSeek/deepseek-error-codes.md](DeepSeek/deepseek-error-codes.md) | 错误码 |
| [DeepSeek/deepseek-rate-limit.md](DeepSeek/deepseek-rate-limit.md) | 速率限制 |
| [DeepSeek/deepseek-anthropic-api.md](DeepSeek/deepseek-anthropic-api.md) | Anthropic API 兼容模式 |

### MiniMax（AI 模型服务）

| 文档 | 说明 |
|---|---|
| [MiniMax/minimax-api-overview.md](MiniMax/minimax-api-overview.md) | API 总览 |
| [MiniMax/minimax-chat-completions.md](MiniMax/minimax-chat-completions.md) | Chat Completions 接口 |
| [MiniMax/minimax-models-intro.md](MiniMax/minimax-models-intro.md) | 模型介绍 |
| [MiniMax/minimax-text-generation.md](MiniMax/minimax-text-generation.md) | 文本生成 |
| [MiniMax/minimax-pricing.md](MiniMax/minimax-pricing.md) | 模型定价 |
| [MiniMax/minimax-prompt-caching.md](MiniMax/minimax-prompt-caching.md) | Prompt Caching 上下文缓存 |
| [MiniMax/minimax-error-codes.md](MiniMax/minimax-error-codes.md) | 错误码 |
| [MiniMax/minimax-rate-limits.md](MiniMax/minimax-rate-limits.md) | 速率限制 |
| [MiniMax/minimax-tool-calls.md](MiniMax/minimax-tool-calls.md) | 函数调用（特别关注 M3 Function Call） |

### 阿里云 AI（Embedding 服务）

| 文档 | 说明 |
|---|---|
| [aliyun/aliyun-text-embedding.md](aliyun/aliyun-text-embedding.md) | 文本 Embedding API |
| [aliyun/aliyun-multimodal-embedding.md](aliyun/aliyun-multimodal-embedding.md) | 多模态 Embedding API |

### MinerU（文档解析服务）

| 文档 | 说明 |
|---|---|
| [MinerU/mineru-api-overview.md](MinerU/mineru-api-overview.md) | API 总览 |
| [MinerU/mineru-agent-api.md](MinerU/mineru-agent-api.md) | Agent API — 智能文档解析 |
| [MinerU/mineru-precision-api.md](MinerU/mineru-precision-api.md) | Precision API — 高精度文档解析 |

### 七牛云（对象存储）

| 文档 | 说明 |
|---|---|
| [qiniu/README.md](qiniu/README.md) | 七牛云文档索引 |
| [qiniu/api-03-overview-of-the-api.md](qiniu/api-03-overview-of-the-api.md) | API 概览 |
| [qiniu/api-12-upload.md](qiniu/api-12-upload.md) | 文件上传 |
| [qiniu/api-04-buckets.md](qiniu/api-04-buckets.md) | 存储空间管理 |
| [qiniu/best-practice-01-mcp-aimodel-kodo.md](qiniu/best-practice-01-mcp-aimodel-kodo.md) | 最佳实践：MCP AI 模型 + Kodo |
| [qiniu/best-practice-02-html2markdown-ai.md](qiniu/best-practice-02-html2markdown-ai.md) | 最佳实践：HTML 转 Markdown + AI |

---

## Claude Code 参考文档

`Claude Code Docs/` 目录是 Claude Code CLI 官方文档的完整副本，包含约 140+ 篇文档，覆盖 CLI 使用、Agent SDK、MCP、权限、部署等所有主题。入口文件：

- [Claude Code Docs/en/overview.md](Claude%20Code%20Docs/en/overview.md) — Claude Code 总览
- [Claude Code Docs/llms.txt](Claude%20Code%20Docs/llms.txt) — LLM 可读的文档索引

经常参考的关键页面：

| 文档 | 说明 |
|---|---|
| [Claude Code Docs/en/agent-sdk/overview.md](Claude%20Code%20Docs/en/agent-sdk/overview.md) | Agent SDK 总览 |
| [Claude Code Docs/en/agent-sdk/typescript.md](Claude%20Code%20Docs/en/agent-sdk/typescript.md) | TypeScript SDK 使用 |
| [Claude Code Docs/en/hooks.md](Claude%20Code%20Docs/en/hooks.md) | Hooks 机制 |
| [Claude Code Docs/en/skills.md](Claude%20Code%20Docs/en/skills.md) | Skill 系统 |
| [Claude Code Docs/en/settings.md](Claude%20Code%20Docs/en/settings.md) | 配置项参考 |
| [Claude Code Docs/en/mcp.md](Claude%20Code%20Docs/en/mcp.md) | MCP 集成 |
| [Claude Code Docs/en/workflows.md](Claude%20Code%20Docs/en/workflows.md) | Workflow 多 Agent 编排 |
| [Claude Code Docs/en/sub-agents.md](Claude%20Code%20Docs/en/sub-agents.md) | 子 Agent 机制 |
| [Claude Code Docs/en/permissions.md](Claude%20Code%20Docs/en/permissions.md) | 权限系统 |
| [Claude Code Docs/en/costs.md](Claude%20Code%20Docs/en/costs.md) | 费用与 Token 用量 |

---

## 维护说明

- 新文档添加到对应分类目录下，并在本索引中补充条目。
- 过时的文档从索引中移除，原文件可根据需要保留或归档。
- 第三方服务文档尽量保持与官方文档同步；版本升级后及时更新对应的 API 参考。
- `superpowers/plans/` 和 `superpowers/specs/` 中的规划完成后，将其条目移至「历史规划」分类或添加完成标记。
