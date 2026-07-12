# Skills 与 Tools

Skill 与 Tool 是 Agent 模式的两层能力描述：Tool 是 AI 可调用的单个原子能力，Skill 是把多个 Tool 按场景打包成的能力组合。

## 本章内容

- [Skill 与 Tool 的关系](#skill-与-tool-的关系)
- [内置 Skill 概览](#内置-skill-概览)
- [内置 Tool 概览](#内置-tool-概览)
- [审批与风险](#审批与风险)
- [使用建议](#使用建议)

## Skill 与 Tool 的关系

- Tool 是具体能做什么，例如读取项目资料、保存 Artifact、搜索 arXiv。
- Skill 是针对某个学习场景，把相关 Tool、提示词和安全策略组合起来，例如论文速读、复习教练、PPT 演示。
- Skill 只能从内置 Tool 中选择并收紧权限，不能引入内置 Tool 之外的操作，也不能放宽 Tool 的风险等级。

当前 Skill 包存放在 `.lumenlab/skills`，每个 Skill 由 `SKILL.md` 和 `policy.json` 组成。`policy.json` 声明显示名称、分类、允许 Tool、风险上限、默认审批策略、数据处理策略和触发词。

## 内置 Skill 概览

| 分类 | Skill | 显示名 | 典型用途 | 风险上限 |
|------|-------|--------|----------|----------|
| academic | `paper-reader` | 论文速读 | 论文速读、精读、多论文对比 | L3 |
| academic | `paper-writer` | 论文写作助手 | 论文初稿、报告结构、引用组织 | L2 |
| academic | `literature-review` | 文献综述 | 研究现状、方法对比、研究空白 | L2 |
| academic | `figure-style` | 图表规范 | 科学图表设计和反模式检查 | L2 |
| academic | `humanizer-zh` | AI 痕迹去除 | 中文文本润色、去 AI 味 | L2 |
| exam | `exam-extract` | 考点分析 | 考点抽取、考试范围 triage | L2 |
| exam | `exam-coach` | 复习教练 | 复习计划、速记卡、自测题 | L2 |
| coding | `code-reader` | 代码阅读 | 代码解释、结构分析、调用路径 | L2 |
| document | `pdf` | PDF 处理 | PDF 阅读、提取、整理 | L2 |
| document | `docx` | Word 文档 | Word 草稿、结构化文档处理 | L3 |
| document | `pptx` | PPT 演示 | 课程展示、答辩、讲稿大纲 | L3 |
| document | `xlsx` | 表格处理 | 表格设计、数据统计、公式说明 | L2 |
| learning | `socratic-tutor` | 苏格拉底导师 | 启发式提问和学习辅导 | L2 |

Skill Router 会根据提问、隐藏快捷任务提示、选中文件、项目上下文和联网意图自动选择 Skill。手动选择 Skill 或关闭 Skill 的优先级最高。

## 内置 Tool 概览

| 风险 | Tool | 能力 |
|------|------|------|
| L1 | `project_files.list` | 列出项目资料 |
| L1 | `project_files.read` | 读取已解析项目资料 |
| L1 | `artifact.list` | 列出成果 |
| L1 | `project_rag.search` | 在项目资料中检索相关段落 |
| L1 | `web.search` | 联网检索关键词 |
| L1 | `web.fetch` | 抓取 allowlist 范围内的公开网页 |
| L1 | `arxiv.search` | 搜索 arXiv 论文 |
| L1 | `arxiv.read` | 读取 arXiv 论文元数据 |
| L1 | `arxiv.fetch` | 抓取 arXiv 公开页面 |
| L1 | `reference.list` | 列出参考文献 |
| L1 | `reference.format` | 格式化 Artifact 上的引用 |
| L1 | `skill.activate` | 激活指定 Skill 指令 |
| L2 | `artifact.save` | 保存 Markdown Artifact |
| L2 | `reference.add` | 新增参考文献 |
| L2 | `reference.attach` | 将参考文献挂到 Artifact |
| L3 | `project_files.delete` | 删除项目资料 |
| L3 | `artifact.export_docx` | 将 Artifact 导出为 DOCX |

`web.fetch` 会做公开 URL 校验、DNS/重定向复核、SSRF 防护、8 秒超时和 1.5MB body 上限，并受 `WEB_FETCH_ALLOWLIST` 控制。

## 审批与风险

- L1 只读或低风险操作默认自动执行。
- L2 会写入用户数据，默认首次询问，当前会话后续同类操作可预批准。
- L3 会删除或生成下载类结果，每次都需要确认。
- L4 是预留的阻断级风险，目前没有生产 Tool 使用。

审批卡片会展示操作名称、影响范围、可逆性和样本。点击「仅本次允许」会用落库的规范化参数兑换一次性审批令牌并立即执行 Tool；参数或 token 绑定不一致时，服务端会拒绝执行。卡片会显示成功、失败或拒绝终态，但不会自动恢复此前暂停的模型 continuation，需要时可发送下一条消息继续。

## 使用建议

- 想基于资料回答时，先上传并等待解析完成，再勾选相关文件。
- 想做论文、复习、代码或文档任务时，可以先让系统自动判断；如果路由不符合预期，再手动切换 Skill。
- 涉及保存、导出或删除时，先读审批卡片的影响范围，再决定允许或拒绝。
