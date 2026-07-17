# LumenLab Agent Skills

> 更新日期：2026-07-17

LumenLab 当前从 `.lumenlab/skills` 发现 13 个内置 Skill。每个 Skill 由 `SKILL.md` 和 `policy.json` 组成；服务端把声明转换为 `SkillMetadata`，再由 Policy Engine 按 Tool allowlist、风险上限、用户 scope、资源归属和审批策略逐次校验。

## 内置 Skill

| 分类 | Skill ID | 版本 | 风险上限 | 典型用途 |
|---|---|---:|---:|---|
| academic | `paper-reader` | 1.0.0 | L3 | 论文速读、精读、多论文对比、引用与 DOCX 导出 |
| academic | `paper-writer` | 1.0.0 | L2 | 论文初稿、报告结构、资料检索与草稿保存 |
| academic | `literature-review` | 1.0.0 | L2 | 文献综述、研究现状、方法对比与研究空白 |
| academic | `figure-style` | 1.0.0 | L2 | 科学图表规范、配色和反模式检查 |
| academic | `humanizer-zh` | 1.0.0 | L2 | 中文润色、降低 AI 痕迹 |
| exam | `exam-extract` | 1.0.0 | L2 | 考点抽取、考试范围与题型整理 |
| exam | `exam-coach` | 1.1.0 | L2 | 复习计划、速记卡、自测题与复盘 |
| coding | `code-reader` | 1.0.0 | L2 | 公开代码库、架构与调用路径理解 |
| document | `pdf` | 1.0.0 | L2 | PDF 阅读、提取与整理 |
| document | `docx` | 1.0.0 | L3 | Word 草稿、结构化文档与 DOCX 导出 |
| document | `pptx` | 1.0.0 | L3 | 课程展示、答辩结构与讲稿大纲 |
| document | `xlsx` | 1.0.0 | L2 | 表格设计、数据统计与公式说明 |
| learning | `socratic-tutor` | 1.0.0 | L2 | 启发式追问与学习辅导 |

Skill Router 的决策顺序为：用户手动选择或关闭、`policy.json` 的 `triggers.include/exclude`、兼容关键词规则、通用模式。手动选择优先级最高；缺少所需项目资料时，Skill 可以进入 `awaiting_context`，不会伪造上下文继续执行。

## 内置 Tool 与风险

| 风险 | Tool | 默认审批 | 说明 |
|---|---|---|---|
| L1 | `project_files.list` | auto | 列出项目资料 |
| L1 | `project_files.read` | auto | 读取已解析项目资料 |
| L1 | `artifact.list` | auto | 列出成果 |
| L1 | `project_rag.search` | auto | 检索项目资料 |
| L1 | `web.search` | auto | 联网检索 |
| L1 | `web.fetch` | auto | 抓取 allowlist 内的公开网页 |
| L1 | `arxiv.search` / `arxiv.read` / `arxiv.fetch` | auto | 搜索、读取与抓取 arXiv |
| L1 | `reference.list` / `reference.format` | auto | 列出与格式化引用 |
| L1 | `skill.activate` | auto | 激活已发现的 Skill 指令 |
| L2 | `artifact.save` | ask_first | 保存 Markdown 成果 |
| L2 | `reference.add` / `reference.attach` | ask_first | 新增或挂载参考文献 |
| L3 | `project_files.delete` | ask_each | 删除项目资料，不可恢复 |
| L3 | `artifact.export_docx` | ask_each | 生成 DOCX 下载 |

L4 为预留的阻断级风险，当前没有生产 Tool 使用。Skill 只能收紧 Tool 权限和审批策略，不能提升风险上限或放宽用户 scope。

## 运行时数据流

```text
用户输入 / 手动 Skill
  → Skill Router 选择 Skill 与任务画像
  → ProviderAdapter 产生规范化 Tool call
  → AgentLoop 去重并控制轮次
  → ToolRunner 加载当前 User.scopes
  → Policy Engine 检查 allowlist、风险、参数和资源归属
  → auto 执行，或签发一次性审批 token
  → handler 执行并更新 ToolExecution / AgentAuditLog
  → 结构化 AgentEvent 通过 SSE 回到前端
```

审批 token 只保存 sha256，绑定 user、conversation、tool、request 和规范化参数哈希。批准时服务端会重新读取当前 Tool、Skill、用户 scope 与资源归属，再原子抢占 `pending_approval` 记录；权限撤销、参数变化或并发状态变化都会阻止执行。

## 注册与维护

- Skill discovery：`src/lib/skills/discovery.ts`
- metadata 转换：`src/lib/skills/migration.ts`
- 注册入口与兼容层：`src/lib/skills/registry.ts`
- Tool 元数据与 handler：`src/lib/tools/registry.ts`
- Policy：`src/lib/agent/policy-engine.ts`
- 执行状态机：`src/lib/agent/tools/tool-runner.ts`

新增 Skill 时创建 `.lumenlab/skills/<category>/<skill-id>/SKILL.md` 与 `policy.json`，声明触发词、允许 Tool、风险上限、required scopes、输入输出契约和数据处理策略，并补 discovery、router 或集成测试。新增 Tool 时在 `src/lib/tools/registry.ts` 注册元数据与 handler，同时补参数、归属、风险和失败路径测试。

面向用户的完整说明见 [Skills 与 Tools](docs/LumenLabDocs/guides/skills-and-tools.md)，审批状态机见 [Policy Engine](docs/LumenLabDocs/architecture/policy-engine.md)。
