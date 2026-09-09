# Research / Paper 测试版交接

## 2026-09-09 · 修复应用内 PDF 预览中文丢失（main）

- 用户反馈：在线预览只有数字与英文，下载后的 PDF 正常。复现确认控制台报 `translateFont failed: Ensure that the cMapUrl API parameter is provided`——`paper-pdf-viewer.tsx` 用 pdf.js 渲染但未提供 CID-keyed 中文字体的 CMap/标准字体表，字形无法映射；浏览器自带 PDF 引擎不受影响，所以下载后正常。
- 修复：`getDocument` 传入 `cMapUrl: "/pdfjs/cmaps/"`、`cMapPacked: true`、`standardFontDataUrl: "/pdfjs/standard_fonts/"`；新增 `scripts/copy-pdfjs-assets.ts` 在 `predev`/`prebuild` 将 `node_modules/pdfjs-dist` 的 `cmaps` 与 `standard_fonts` 复制到 `public/pdfjs/`（写版本标记，重复运行跳过；目录已加入 `.gitignore`，不进仓库）。
- 验证：真实浏览器打开 `/papers/formatting/a5a4068a-…` 控制台零警告，画布渲染出中文标题与作者，与下载 PDF 一致；新增 `paper-pdf-viewer.test.tsx` 断言 `getDocument` 携带 CMap 参数。334 文件 / 1870 测试、tsc、ESLint、production build、diff check 全绿；提交 `74de1d4` 已推送 main。
- 后续 UI 微调：「历史任务」分组图标由 `WarningTriangle` 换为 `ClockRotateRight`（`2f1c27f`，CI 全绿）。

## 2026-09-09 · AnySearch 统一联网搜索接入（main）

- 目标：`web.search` 从 Bing RSS → DuckDuckGo 原型搜索升级为平台自有搜索栈 **AnySearch → Bing RSS → DuckDuckGo**，并彻底解除联网搜索与 DeepSeek API Key 的耦合。上层 Agent 只调用统一 `web.search`，模型供应商不决定搜索 Provider；不引入 MCP、不替换 `web.fetch`、不改 SSRF/DNS pinning。
- 新增 `src/lib/tools/web/anysearch.ts`：唯一 HTTP 传输（`POST https://api.anysearch.com/v1/search`、`Authorization: Bearer ${ANYSEARCH_API_KEY}`、JSON）；请求体 camelCase→`max_results`，按官方范围钳制 1–10；`tag/zone/language/params` 仅在提供时透传；响应解析 `{code,message,request_id,data:{results,metadata}}`，逐项读取 title/url/snippet/content，只接受 http(s) 且按 canonical URL 去重；400 直接回退、401/403 记安全日志后回退、402 不重试直接回退、429 最多一次有界重试（尊重 Retry-After，超过 2s 上限直接回退）、5xx/网络一次 300ms 退避后回退。
- `search-engine.ts`：缓存键升级为 `websearch:v3:{maxResults}:{tag}:{zone}:{language}:{stableParams}:{normalizedQuery}`，不同 tag/区域不再互相命中；AnySearch 成功且有结果立即返回、空结果继续 fallback、无 key 完全跳过 AnySearch；Bing RSS 与 DuckDuckGo 保留原相关性闸门，AnySearch 因已自带 routing/fusion/rerank 只做结构/URL 校验与去重。summary 默认标题+snippet+原始 URL，snippet 缺失时才从 content 截取 200 字符。
- `search.ts` 不再解析任何模型供应商密钥；`src/lib/agent/runtime.ts` 的 MiniMax 手动联网预取同样去掉 DeepSeek 密钥解析。Tool Registry 的 `web.search` description 改为“平台统一联网搜索”，input schema 扩展 `tag?/zone?/language?/params?` 且保持向后兼容；已注明 `code.doc` 需 `params.library`、`academic.citation` 需 `params.id`、`security.vuln` 需 `params.type/value`（实测这些 tag 缺参返回 `code:-1`）。
- 真实联网验证：中文查询、`academic.search`+en（返回 DOI 论文）、`code.doc`（真实 400 → 自动回退 Bing 并返回 React 文档）、`maxResults:25` 被钳制到 10、无 key 时跳过 AnySearch 全部符合预期；本机 `localhost:3000` 真实对话（Qwen3.8-Flash + 联网开关）中 Agent 调用 5 次 AnySearch，答案引用原始 URL（10 个工具、89,669 tokens）。证据 `output/playwright/anysearch/`。
- 门禁：333 文件 / 1869 测试、tsc、ESLint（0 问题）、Prisma validate、production build、diff check 全绿；提交 `9d5c613` + `224049f` 已推送 main，CI run [34263842621](https://github.com/mkynyd/lumenlab/actions/runs/34263842621) 全绿。**官方 Docs 与提示词差异**：提示词写 `max_results` 1–20，官方接口文档为 1–10 且实测服务端返回上限为 10，按“以最新官方 Docs 为准”实现 1–10。
- 未做（按要求）：AnySearch MCP/Skill、`/v1/deep-search`、替换 `web.fetch`、删除 Bing/DDG fallback、前端搜索 Provider 选择器、向用户暴露 AnySearch Key、完整 Deep Research。

## 2026-09-09 · 任务 11 完成：后台论文排版与旧编辑功能退场

- 入口与向导：新增 `/api/papers/formatting`（提交/列表）、`/api/papers/formatting/templates`（学校搜索 + 逐 Variant 可用性与原因 + 计数）、`/[id]`（详情/取消/重试/确认/原稿下载）；`/papers` 改为任务与结果列表，`/papers/typesetting` 改为「选学校模板 → 填元数据 → 上传原稿」向导，`/papers/formatting/[id]` 展示阶段进度、结构确认与 PDF 预览/下载，`/papers/[id]` 改为只读历史论文（大纲 + 最近成功 PDF）。前端 hooks 与查询键集中在新 `use-formatting.ts`。
- 模板准入改为当前快照 + 隔离 Linux 证明：`formattingTemplateAvailability` 要求 manifest 与 `pinnedUpstreamSnapshot` 一致、`validation.status=Verified`、样例 PDF 可读，且 `validation.formattingValidation` 记录 `environment=linux-isolated` 且 `samplePassed/docxPassed/markdownPassed` 全为真；引擎/文档类缺失时回落到隔离验证记录的 `compileEngine/resolvedDocumentClass`。
- 隔离验证脚本：`scripts/validate-template-snapshots.ts` 在 `TEMPLATE_VALIDATE_FORMATTING=1` 时于同一隔离工作目录追加 DOCX 与 Markdown 两轮真实编译（`src/lib/paper/formatting-fixtures.ts` 提供确定性中英双语夹具），三者全过才写入 `formattingValidation`。**重庆大学 `cquthesis` 与四川大学 `scuthesis`（2016 cuiao 模板）已产出证明，PDF 78,570 / 121,531 字节**。
- 修复两处真实模板缺陷：① 生成 main.tex 时未携带只在上游入口文件声明的 `\bibliographystyle`（CQU 报 “I found no \bibstyle command”），现从入口源提取纯标识符样式名；② 2016 版 `scuthesis` 仍走基类 `\maketitle`（报 “No \title given.”），现同时输出 `\title/\author`。
- 修复租约围栏时区缺陷：Prisma 的 `DateTime` 在 PostgreSQL 是 `timestamp without time zone`，而围栏原生 SQL 用 `NOW()`（会话时区 Asia/Shanghai）比较，导致租约判定恒为过期、排版任务每次 30 秒被回收直至 `max_attempts_exceeded`。现改为绑定 JS 时间参数，并新增回归测试断言不使用 `NOW()`。另外，租约耗尽（poisoned）时补充终态通知投影，避免排版任务永久停留在“排队中”。
- 编辑退场：删除 `paper-workspace.tsx`、`paper-template-binding-panel.tsx`、`paper-references-panel.tsx`、`document-editor-operations.ts`、`ai-assistant.ts` 与 assistant/patches/template/imports/assets/references 写路由；`workspaces`、`workspaces/[id]/document`、`documents/[id]/compile`、`documents/[id]/versions`、`imports/[id]` 只保留 GET，`src/lib/paper/editor-retirement.test.ts` 断言只读路由无写方法、已删除路由不可导入。
- 隔离编译环境修复（真实 Linux 验证发现）：Docker 默认 seccomp 拒绝非特权容器创建用户命名空间，`docker-compose.paper-compiler.yml` 增加 `seccomp=unconfined`（能力仍全部丢弃）；bwrap 在 `--ro-bind / /` 后无法创建挂载点，镜像新增 `/compile-workspace`，README 记录裸机部署要求。
- 真实验收（本机 `localhost:3000`、真实账号、真实 Qwen3.8-Flash、真实七牛、隔离 Linux 编译容器）：DOCX（重庆大学）与 Markdown（四川大学）各完成「上传→导入→分批映射→渲染→编译→完整性校验→完成通知」，PDF 39,473 / 88,966 字节、`contentIntegrity=passed`、`protectedDocumentHash` 一致；缺图注 DOCX 触发 `needs_input`，确认后完成；同 requestKey 重放返回同一任务、换原稿复用标识返回 409；取消后 5 秒仍为 cancelled 且重试被拒；不支持的原稿失败并可重试（attempt 递增）。PDF 文本抽取确认中文字体、摘要、图片题注、表格、公式、脚注均在。证据 `output/playwright/task-11/`。
- 门禁：332 文件 / 1839 测试、`tsc --noEmit`、ESLint（0 问题）、Prisma validate、41 迁移、production build（161 页）、`git diff --check` 全绿。未提交、未推送、未部署。
- 仍未完成：编译失败的模型自动修复轮次（当前明确失败并可人工重试，见 11-TODO 注释）。

## 2026-09-09 · 任务 11 进行中：后台论文排版基础已落地，尚未收口

- 二次同步 main 已完成并提交 `1ea4323`；当前分支为 `feature/research-paper`。Research/Paper 历史模型、main 的附件与通知模型均保留。
- 新增排版领域合同与持久任务骨架：`PaperFormattingTask`、`PaperFormattingMappingBatch` 及迁移 `20260908234500_paper_formatting_tasks`；任务冻结 `sourceHash`、模板快照、实际模型、计费版本、attempt、阶段进度和结果引用，幂等键为 `userId + requestKey`。
- 新增导入/映射安全边界：DOCX/Markdown 首版、`.doc` 明确拒绝；受限 OMML/Markdown 结构转换、图片私有保存、公共图片走既有 allowlist + DNS pinning；AI 只输出有 schema 的块角色映射，长文档按批覆盖，正文/公式/图表/引用保真 hash 校验，低置信度进入 `needs_input`。
- 新增 `paper-formatting` durable execution 分派与 Paper 任务源；排版任务不再混入普通 Chat 列表/通知。导入、结构映射、模板渲染、编译等待、PDF/source 完整性验证与完成通知按阶段持久化；取消、租约失效和迟到结果均有 fence。
- 模板准入新增当前快照、Linux 隔离样例、DOCX/Markdown 双输入验证条件；当前数据库盘点为 738 条 Registry、567 个 Variant、43 个历史样例 Verified，不能直接视作 43 个当前可提交模板。Docker 编译器镜像正在构建，Linux 隔离与两个学校的真实端到端仍未完成。
- 当前验证：任务 10 合入后的基线全量 329 文件 / 1823 项测试通过；本轮新增映射定向测试尚未并入最终全量门禁。`npx tsc --noEmit`、`prisma validate`、`git diff --check` 通过；迁移 diff 识别到预期新增表/索引/外键。未运行 `migrate deploy`、未完成 production build、真实浏览器端到端、隔离编译或真实模型排版；未 commit/push/deploy 本轮代码。
- 尚未完成：11A 模板页面替换、11B 上传向导接线、11C 映射确认 API/UI、11D 编译 Worker 任务锁定版本和完成回执的最终回归、11E 旧编辑 UI/assistant/patch/任意正文写 API 的逐路由关闭、11F 两校 DOCX/Markdown 与取消/重复/恢复矩阵。

## 2026-09-08 · 任务 11 开始：二次同步 main 完成

- 固定 main `0ed0c487a37c1022e91653bb7a7f699a6d3deea5`、feature `7292bad59d311b78a0f5759c6abba2ad04c1edd0`；工作树干净且与远端一致。合并提交 `1ea4323`。
- 三处冲突按语义合并：`.env.example` 保留 Research 覆盖配置与 Qwen 新默认说明；Prisma 同时保留 Research/Paper 与 Notification；媒体测试保留新 loader 的大小和批次查询语义，修复自动合并漏掉 size 参数。
- 合并候选：329 文件 / 1823 测试通过，TypeScript、ESLint、Prisma validate/generate、diff check 通过。尚未执行本轮 production build、数据库迁移和真实 E2E。
- 正在继续 11A—11F；未把后台排版或编辑退场标记完成。Docker daemon 当前未启动，Linux 隔离编译验证仍需准备。


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
- 任务 06 不部署。14 条 A/B 模板来源和 Linux `texlive-full` 隔离全量验证仍是既有边界；进入任务 11 前需按方案再次同步届时最新 main。代码合并提交 `faf5630`、Turbopack 恢复文档提交 `8ffb83e`、交接封存提交 `b02c402` 均已推送；手动 CI `34178694687` 的注册页 5 秒偶发超时单独保留，不在本轮修复。任务 06 已封存，按用户要求不自动进入 07。

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
