# Research / Paper 测试版交接

## 2026-09-08 · 本地 Turbopack 冲突标记错误恢复

- 用户看到 `durable-agent-runtime.ts:732` 的 `>>>>>>> 25befed5...` build error。核对当前工作树、HEAD `faf5630a75a01bef324bd9eb9ebc358d1f69845b` 与 `origin/feature/research-paper` 后确认三者源码均无 `<<<<<<<`/`>>>>>>>`，Git index 也无未解决条目；正确语义是先派发 `executionKind === "research"`，随后处理 chat 的已完成 output，再升级旧 Checkpoint。
- 错误只存在于 `.next/dev/logs/next-development.log` 和从合并前持续运行的 Next dev/Turbopack 进程中。该进程仍让 `GET /home` 返回 500，即使源码与 production build 已正常，根因是 dev 编译器保留了合并中间态的失败快照。
- 仅对本仓库已核对的 dev 进程做 graceful restart，没有删除 `.next`、数据库、上传文件或其他缓存。重启后 `http://127.0.0.1:3000/home` 连续返回 200，首页/聊天与相关 API 重新编译成功；dev server 保持运行。
- 回归：仓库 marker scan 无命中；durable runtime/store 定向 2 文件 50 项通过；Next.js production build 77 页面通过，仍只有既有 Paper compile-worker NFT tracing warning。
- 手动 feature CI [34178694687](https://github.com/mkynyd/lumenlab/actions/runs/34178694687) 的 macOS lockfile、Linux lint/tsc 通过，但 Linux 全量测试再次命中已有注册页 5 秒偶发超时（306 文件 / 1679 项通过），后续仍需独立收口；它与本次 conflict-marker/Turbopack 500 无关。按用户要求，本子任务完成后停止，不继续任务 07。

## 2026-09-08 · 任务 06 Responses/Checkpoint 分支适配完成

- 在 `feature/research-paper` 合入固定 main `25befed5bd4068dd1fb9570a7d317ac4f0a8795d`（合并前 feature `038e00ce9d751fe7acb39898ad9304f8f1020d49`）。四个冲突均语义整合：`.env.example`、本地保留但 Git 删除的 `docs/TODO.md`、Checkpoint store、durable runtime；未用整文件 ours/theirs。
- Checkpoint v1/v2 都保留 Research 状态，v2 新写入不含供应商私有载荷；chat v1→v2 恢复、Research `executionKind` 派发、`requeue`/`resumeOwned`、取消和 Follow-up 均保留。结构化 Research 阶段只解析持久化最终 Message，reasoning 不进入 JSON，非 completed 关闭为 unavailable。
- Research 五角色默认改为活跃 `deepseek-v4-flash-vision-exp`；角色环境覆盖接受活跃 ID 或升级已知历史 ID，未知值明确报错。Paper DOCX 分类复用 evaluator 角色选择；旧 Paper Assistant/patch API 只标记为任务 11 待退场，本轮不新增编辑能力。
- Research 阶段不把 `projectId` 交给通用 Chat 媒体装配，避免任务 05 的文件名匹配自动注入未选择项目图片；Research 自身明确提供的资料、公开事件、Evidence/Claim、预算与报告引用保持不变。
- 真实验证：provider 暂停→恢复在同一用例中完成（恢复调用 `totalTokens=3988`）；完整 Quick Research 经过计划确认、研究、评估、合成、验证并冻结报告，`modelCalls=7`、`totalTokens=46849`、Evidence/Source 各 11、content hash `74c0467ec06eb4be9578d4f21b50640f431aba5450a735b06a115fe42dc0a8f9`。Paper DOCX 模糊 drawing 分类返回 `completed / figure`。所有临时 Research 数据已清理。
- 最终门禁：307 个测试文件 / 1680 项、TypeScript、ESLint、Prisma schema、37 个迁移状态、production build（77 页面）、diff check 全绿；Paper 模板/预览/编译定向 6 文件 27 项通过。构建仅保留既有 compile-worker NFT tracing warning。
- 任务 06 不部署。14 条 A/B 模板来源和 Linux `texlive-full` 隔离全量验证仍是既有边界；进入任务 11 前需按方案再次同步届时最新 main。下一步为完成 merge commit、推送并等待 CI，然后回到 main 实施任务 07。

## 2026-09-06 · GPT-6 / Codex

- 工作分支：`feature/research-paper`，起点 `58b5b40772ca3c3f21d4dbcac10e2acf4eadddb2`。远端已核对一致；不合并 main，不部署。
- 已读取任务 `01a02f71-85dd-70d2-a7f5-0c52381e9dff`、领域 ADR、当前实现和 TODO。CodeGraph 索引仍是 main，未收录实验模块，实验代码改用直接读取。
- Research 的目的：从计划确认、检索、证据/主张整理到不可变报告，复用既有 AgentExecution。Paper 的目的：结构化文档是正文来源，学校模板负责 LaTeX 排版，支持手动写作、PDF 预览和可选 AI 修改建议。两者通过显式资料转移连接。
- 本轮模块：模板入口前置、标题/章节/正文卡片折叠与大纲定位、连续编辑和自动保存修复。保持既有文档格式与编译 API。
- 已确认问题：编辑操作在 draftDocument 为 null 时不生效；自动保存清空草稿但不更新工作区缓存，造成旧内容回显。修复后验证首次输入、保存后继续输入及刷新持久化。
- 后续独立事项：继续提高学校模板实际编译覆盖率。Research 真实模型端到端已由 2026-09-08 任务 06 补齐；旧对话中的模板数量是历史快照，不作为当前验证结果。
- 已完成：学校模板选择前置，应用模板后请求更新 PDF；标题/摘要/正文等卡片可折叠，章节按层级包含下属卡片，支持全部折叠、大纲局部展开定位、章节添加、正文添加和既有整节移动。移动章节保留末尾参考文献。
- 已修复：首次编辑和保存后继续编辑；保存结果同步到工作区查询缓存；串行保存避免后发请求被先发覆盖，旧响应不清除更新的草稿；元数据标题同步文档标题；自动保存后更新版本历史。
- 已通过：目标 ESLint、TypeScript；文档操作/schema/LaTeX renderer 共 3 文件 26 测试；本机 XeLaTeX 输出中文 PDF（1 页）。浏览器 4 次保存、5 次编译请求，首次编辑/请求期间输入/保存后编辑/刷新回读/折叠/大纲局部展开/新增章节正文/单一标题/模板绑定/PDF.js 均通过，console error 为 0，移动端无横向溢出；结果见 `/tmp/lumenlab-paper-beta/result.json`。
- 验证环境：`http://127.0.0.1:3000/papers/beta-qa`，Playwright + Chrome，1600×1100 和 390×844。API 为测试数据，PDF 来自真实 renderer + XeLaTeX；本机 PostgreSQL/Docker 未运行，未验证服务端数据库/Worker 端到端及真实学校模板编译。
- 浏览器证据与临时脚本：`/tmp/lumenlab-paper-beta/`（未纳入 Git）。模板筛选中的“测试大学”仅为脚本中的 fixture，未添加到产品模板库。
- 不需要数据库迁移或新依赖。最终提交仅推送 `feature/research-paper`，不部署。

## 2026-09-06 · PDF 预览 Failed to fetch 修复

- 原因已由真实浏览器 Network/Log 确认：PDF API 将 fetch 重定向到七牛域名，被页面 `connect-src 'self'` 拦截（blockedReason=csp）。与 GitHub 模板获取无关。
- 实际编译 `cmtoo6jrp00063ac9hz2pdphs` 状态 succeeded，XeLaTeX；重庆大学模板为 materialized 七牛快照 `template-snapshots/cqu-bdsc__CQUThesis/1a8441c5a24e5ecafd47614d28bfc137e42d6153.normalized-v2.zip`。PDF 同样存储于七牛，服务端读到 15,761 字节、有效 `%PDF-` 文件头。
- PDF API 保留归属校验，在服务端读取对象并同源返回 PDF，添加 private/no-store；不修改 CSP、不修改七牛配置、不搬迁模板。
- 真实登录页面 `http://localhost:3000/papers/cmt70nrkv0000jbc9dx8a07nt` 刷新后显示“第 1 / 2 页”；PDF 同源 GET 200 application/pdf，修复后网络记录无 CSP 错误。未修改论文正文或重新生成编译任务。
- 定向验证：PDF 路由 2 项测试（七牛 PDF 返回字节、不跳转、归属隔离）与 ESLint 通过。
