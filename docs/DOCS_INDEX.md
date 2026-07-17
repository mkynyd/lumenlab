# 文档索引

> 更新日期：2026-07-17

本目录包含 LumenLab 自身文档、实现与 QA 记录，以及开发时使用的第三方服务参考。面向用户的在线文档由 `docs/LumenLabDocs` 直接驱动，发布在 [lab.mkynstudio.top/docs](https://lab.mkynstudio.top/docs)。

## 项目核心文档

| 文档 | 说明 |
|---|---|
| [README](../README.md) | GitHub 项目展示、架构、快速开始与生产发布 |
| [PROJECT_SUMMARY](../PROJECT_SUMMARY.md) | 截至 2026-07-17 的实现与生产状态摘要 |
| [PRODUCT](../PRODUCT.md) | 产品定位、目标用户与设计原则 |
| [DESIGN](../DESIGN.md) | 前端视觉与动效规范 |
| [SKILLS](../SKILLS.md) | 13 个 Skill、17 个 Tool 与审批模型 |
| [IMPLEMENTATION](../IMPLEMENTATION.md) | 四层缓存实现说明 |
| [AGENTS](../AGENTS.md) | 仓库协作、Git 与 UI 约束 |

`REPOSITORY_INDEX.md` 是 gitignored 的本地 Agent 索引，不会显示在 GitHub；需要以当前工作区副本为准。

## LumenLab 应用文档

### 产品与上手

| 文档 | 说明 |
|---|---|
| [文档入口](LumenLabDocs/README.md) | 文档地图与在线入口 |
| [产品概览](LumenLabDocs/overview.md) | 产品定位、多模型、资料、Agent 与成果能力 |
| [快速开始](LumenLabDocs/getting-started.md) | 注册、对话、项目、上传与导出 |
| [部署](LumenLabDocs/deployment.md) | 当前生产发布与独立自托管 |
| [常见问题](LumenLabDocs/faq.md) | 普通用户高频问题 |

### 使用指南

| 文档 | 说明 |
|---|---|
| [项目管理](LumenLabDocs/guides/projects.md) | 项目类型、上下文与资料管理 |
| [资料与 RAG](LumenLabDocs/guides/files-and-rag.md) | 上传、解析、检索与资料图谱 |
| [成果与导出](LumenLabDocs/guides/artifacts.md) | Artifact、Markdown / DOCX / PDF |
| [Agent 模式](LumenLabDocs/guides/agent-mode.md) | Tool loop、审批与 Provider 边界 |
| [Skills 与 Tools](LumenLabDocs/guides/skills-and-tools.md) | 内置能力、风险等级与使用建议 |

### 架构与参考

| 文档 | 说明 |
|---|---|
| [架构总览](LumenLabDocs/architecture/overview.md) | AgentRuntime、Provider、RAG 与部署边界 |
| [任务路由](LumenLabDocs/architecture/task-router.md) | DeepSeek / MiniMax / Qwen 路由与 Adapter |
| [Policy Engine](LumenLabDocs/architecture/policy-engine.md) | scope、风险、审批 token 与状态机 |
| [缓存架构](LumenLabDocs/architecture/cache.md) | 四层缓存与指标 |
| [数据模型](LumenLabDocs/architecture/data-model.md) | Prisma 领域模型 |
| [API 参考](LumenLabDocs/reference/api.md) | 当前主要 Route Handler 合同 |
| [配置](LumenLabDocs/reference/configuration.md) | 环境变量、Provider 与发布开关 |
| [错误处理](LumenLabDocs/reference/error-codes.md) | 注册、上传、检索、导出和 Agent 排查 |

## 实现与 QA 记录

| 文档 | 说明 |
|---|---|
| [Agent Orchestrator diff](agent-orchestrator-diff.md) | Runtime 迁移差异记录 |
| [Token 与上下文预算](token-usage-context-budget-compression.md) | 用量、预算与压缩策略 |
| [Artifact 导出](artifact-export.md) | 导出实现笔记 |
| [PostgreSQL + pgvector](database-postgresql-pgvector.md) | 数据库与向量配置 |
| [LumenLab A-test QA](qa/lumenlab-a-test-2026-07-11.md) | A 测硬化验证 |
| [Pi/Qwen POC QA](qa/pi-ai-qwen-poc-2026-07-16.md) | `pi-ai` 与 Bailian Qwen 验证 |
| [TODO](TODO.md) | 待办汇总；内容可能早于当前主线，执行前需重新核对源码 |

## 第三方服务参考

这些文件是开发期保存的厂商资料副本，不是 LumenLab 的运行合同；模型、价格、限额和接口可能变化，实际接入应以当前源码与厂商官方文档为准。

- `DeepSeek/`：Anthropic 兼容、Tool、推理、缓存、用量和错误码。
- `MiniMax/`：M3、Messages / Chat、Function Call、Prompt Cache 和限额。
- `MinerU/`：Agent API、Precision API 与 PDF 解析。
- `aliyun/`：百炼文本与多模态 embedding。
- `qiniu/`：Kodo 上传、私有下载、对象管理和最佳实践。

## 维护规则

- 产品能力变化时，先更新 `README.md` 和受影响的 `LumenLabDocs` 页面，再同步 `PROJECT_SUMMARY.md`、`SKILLS.md` 或本索引。
- 新增站内页面时，同时在 `src/lib/docs/docs-nav.ts` 注册 slug 和文件路径。
- API 参考只记录真实存在的 Route Handler 与方法，不记录规划接口。
- 第三方资料副本与运行合同分开维护，避免把旧价格或旧模型名写入产品文档。
