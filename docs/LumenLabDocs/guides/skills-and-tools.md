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

Deep Research 是特殊消费者：它只读取受信 Skill 的研究方法论章节，经服务器按阶段裁剪后加入 structured prompt，不激活普通 Agent Skill，也不读取其 `allowed_tools` 作为 Research 权限。Research 的 checkpoint 始终 `skillOff: true` 且没有 user-facing `skillId`，工具面仍由 checkpoint、Tool Registry、L1 policy、预算与 provider/runtime 限制。

## 内置 Skill 概览

| 分类 | Skill | 显示名 | 典型用途 | 风险上限 |
|------|-------|--------|----------|----------|
| academic | `deep-research-core` | 深度研究核心方法 | 所有 Deep Research Run 的默认方法论 | L1（无 Tool） |
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

普通“思想汇报”不会触发 PPT Skill；明确要求 PPT 或幻灯片时才匹配相关触发词。本轮已开启的联网搜索与网页读取独立于文档 Skill 的工具列表，仍受 Tool 自身权限、参数、工作区规则和用户显式禁用设置约束。

## Skill 来源与版本

运行时按 `project > user > managed > bundled` 合并 Skill；同 ID override 会在 catalog 中显示 active source 与被覆盖来源。`.lumenlab/skills` 是随 release 发布的 bundled layer，后台只检测 upstream，不写 Git 目录。Managed layer 位于 `LUMENLAB_MANAGED_SKILLS_DIR` 的共享目录；user/project layer 默认不参与自动更新。

Managed updater 与 CLI 共用一套 service。候选先下载到隔离 staging，校验 frontmatter、policy、路径、文件大小、symlink、可执行资源、Tool ID、scope、risk、approval 与资源规则，再比较实际 policy。新增 Tool、提高风险、扩大 scope/resource、放宽审批、允许外发、trust/identity 变化或可执行资源都会进入 `review_required`；纯说明修订与权限收紧可自动 promotion。Promotion 与 rollback 都通过原子 manifest 切换，失败不改变 current，随后热刷新 catalog，无需重启服务。

默认每 24 小时检查一次，并有 0–60 分钟确定性 jitter、最小 1 小时周期和最长 6 小时退避；共享目录租约防止多个进程同时 promotion。`GET /api/skills/managed` 提供认证后的脱敏状态，operator 可通过 API 或 `npx tsx scripts/skills-managed.ts status|check|update|approve|rollback [skillId]` 操作。API operator 由 `SKILL_UPDATE_ADMIN_EMAILS` 明确配置；只有显式 `approve` 能启用已审阅的权限扩张，普通用户不能修改 trust 或绕过审核。

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
| L1 | `sciverse.search` | Sciverse 学术检索（标题 / 摘要） |
| L1 | `sciverse.semantic_search` | Sciverse 语义检索，按 docId 返回命中段落 |
| L1 | `sciverse.read` | 按偏移读取 Sciverse 文献正文片段 |
| L1 | `reference.list` | 列出参考文献 |
| L1 | `reference.format` | 格式化 Artifact 上的引用 |
| L1 | `skill.activate` | 激活指定 Skill 指令 |
| L2 | `artifact.save` | 保存 Markdown Artifact |
| L2 | `reference.add` | 新增参考文献 |
| L2 | `reference.attach` | 将参考文献挂到 Artifact |
| L3 | `project_files.delete` | 删除项目资料 |
| L3 | `artifact.export_docx` | 将 Artifact 导出为 DOCX |

`web.fetch` 会做公开 URL 校验、DNS/重定向复核、SSRF 防护、8 秒超时和 1.5MB body 上限，并受 `WEB_FETCH_ALLOWLIST` 控制。即使显式加入 allowlist，IPv4、IPv6、IPv4-mapped IPv6 的 loopback、私网、link-local、ULA、multicast 和 IANA 特殊用途地址仍会被拒绝。连接使用已验证的 DNS 结果，不会在连接时再解析域名；每个重定向目标都会独立复核和固定。

除上表外，学习闭环还注册了 `learning.*` 系列工具（目标、地图、练习、作答、复习、进度，L1 / L2）和 `plan.update`（L0，研究/工作流路由的计划步骤），它们只在项目学习场景中进入候选工具集。

## 从聊天下载 Word

在聊天中要求“生成可下载的 Word / DOCX”，或追问“把刚才内容转成 Word”。Word Skill 使用 `artifact.save` 保存正文，再用 `artifact.export_docx` 导出；已有成果可直接复用。工具自动执行完成后，聊天过程区显示“下载 Word”，模型也可引用工具返回的真实下载链接。

导出工具复用成果下载接口和缓存，二进制文件不会进入模型上下文或持久执行事件。每次下载仍校验登录及成果归属。正常导出与无 Pandoc 时的备用导出共用 Noto Sans SC 中文样式，明确设置东亚字体和 `zh-CN`，并随 DOCX 嵌入允许再分发的字体（OFL，fsType=0）。若阅读器不支持嵌入字体，会使用其本机字体替代。

## 审批与风险

所有通过服务端校验的 Tool 均自动执行，包括成果保存、Word 导出、引用和已授权的资料删除。风险级别继续用于审计和 Skill 能力范围，不再触发人工审批。工具注册、账号 scope、Skill allowlist/风险上限、参数、资源归属和显式 `block` 仍然生效；历史 `ask_first` / `ask_each` 偏好不会使任务暂停。

历史等待审批任务在打开对话时自动恢复，服务端重新检查原始参数与归属并原子领取执行；正在执行或已完成的工具不会重复执行。保留旧批准/拒绝 API 用于存量任务兼容。

## 使用建议

- 想基于资料回答时，先上传并等待解析完成，再勾选相关文件。
- 想做论文、复习、代码或文档任务时，可以先让系统自动判断；如果路由不符合预期，再手动切换 Skill。
- 保存、导出等操作直接在聊天发出需求，完成后使用实际下载入口。
