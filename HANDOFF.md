# Research / Paper 测试版交接

## 2026-09-06 · GPT-6 / Codex

- 工作分支：`feature/research-paper`，起点 `58b5b40772ca3c3f21d4dbcac10e2acf4eadddb2`。远端已核对一致；不合并 main，不部署。
- 已读取任务 `01a02f71-85dd-70d2-a7f5-0c52381e9dff`、领域 ADR、当前实现和 TODO。CodeGraph 索引仍是 main，未收录实验模块，实验代码改用直接读取。
- Research 的目的：从计划确认、检索、证据/主张整理到不可变报告，复用既有 AgentExecution。Paper 的目的：结构化文档是正文来源，学校模板负责 LaTeX 排版，支持手动写作、PDF 预览和可选 AI 修改建议。两者通过显式资料转移连接。
- 本轮模块：模板入口前置、标题/章节/正文卡片折叠与大纲定位、连续编辑和自动保存修复。保持既有文档格式与编译 API。
- 已确认问题：编辑操作在 draftDocument 为 null 时不生效；自动保存清空草稿但不更新工作区缓存，造成旧内容回显。修复后验证首次输入、保存后继续输入及刷新持久化。
- 后续独立事项：Research 真实模型端到端验证；继续提高学校模板实际编译覆盖率。旧对话中的模板数量是历史快照，不作为当前验证结果。
- 已完成：学校模板选择前置，应用模板后请求更新 PDF；标题/摘要/正文等卡片可折叠，章节按层级包含下属卡片，支持全部折叠、大纲局部展开定位、章节添加、正文添加和既有整节移动。移动章节保留末尾参考文献。
- 已修复：首次编辑和保存后继续编辑；保存结果同步到工作区查询缓存；串行保存避免后发请求被先发覆盖，旧响应不清除更新的草稿；元数据标题同步文档标题；自动保存后更新版本历史。
- 已通过：目标 ESLint、TypeScript；文档操作/schema/LaTeX renderer 共 3 文件 26 测试；本机 XeLaTeX 输出中文 PDF（1 页）。浏览器 4 次保存、5 次编译请求，首次编辑/请求期间输入/保存后编辑/刷新回读/折叠/大纲局部展开/新增章节正文/单一标题/模板绑定/PDF.js 均通过，console error 为 0，移动端无横向溢出；结果见 `/tmp/lumenlab-paper-beta/result.json`。
- 验证环境：`http://127.0.0.1:3000/papers/beta-qa`，Playwright + Chrome，1600×1100 和 390×844。API 为测试数据，PDF 来自真实 renderer + XeLaTeX；本机 PostgreSQL/Docker 未运行，未验证服务端数据库/Worker 端到端及真实学校模板编译。
- 浏览器证据与临时脚本：`/tmp/lumenlab-paper-beta/`（未纳入 Git）。模板筛选中的“测试大学”仅为脚本中的 fixture，未添加到产品模板库。
- 不需要数据库迁移或新依赖。最终提交仅推送 `feature/research-paper`，不部署。
