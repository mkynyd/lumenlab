# LumenLab Agent 审计报告（2026-08）

> 审计时间：2026-08-14 · 审计者：DeepSeek V4 Pro（DeepSeek Harness，4 个并行审查代理）
> 范围：light-ai-chat 的 RAG/文档解析、Agent 运行时（循环/工具/停止/压缩/持久执行）、宣传物料
> 性质：只读审查，所有路径相对 `light-ai-chat/`；本文件存档结论与实施路线图

---

## 第一部分：Agent 运行时问题清单

### P0（必须修）

| # | 问题 | 证据 | 修复方向 |
|---|---|---|---|
| P0-1 | **Token 计量只记最后一轮**：8 轮工具循环真实 8 次计费，记账只取 finalRound 的 usage | `src/lib/agent/runtime.ts:1471-1488`、`agent-loop.ts:195-207`、`deepseek.ts:398-407` | 循环每轮 buffer 后累加 usage，`mergeAgentUsage` 汇总后持久化 |
| P0-2 | **压缩是"假压缩"**：只插入摘要、不删旧消息，prompt 每压缩一次反而变长 | `src/lib/chat/compression.ts:95-112`、`api/chat/compact/route.ts:81-92`、`runtime.ts:1001-1017`、`prisma-conversation-adapter.ts:120-131` | buildCompressedMessages 丢弃可压缩消息；compact/runtime 两条路径都落库标记替换；loadHistory 过滤已替换消息 |
| P0-3 | **Durable 审批恢复从零重跑**：checkpoint 的 `pendingToolCall` 只写不读，模型看不到审批前推理 | `durable-agent-runtime.ts:331-350`、`prisma-agent-execution-store.ts:856-938`、`runtime.ts:825-839` | 恢复时把 pendingToolCall+审批结果合成延续消息注入；或从 pending 轮断点继续 |
| P0-4 | **非 durable 审批是断头路**（默认路径）：审批后流即结束，approve 只执行工具不续跑 | `agent-loop.ts:149-156`、`runtime.ts:1241-1260`、`approve/route.ts:294-376`、`feature-flags.ts:34-35` | approve 后触发带工具结果的续跑请求；或 durable 设为默认并修好 P0-3 |

### P1（尽快修）

- **P1-1 单次心跳失败即杀运行 + 过期租约只在 worker 启动时回收** → 执行永久卡死（`agent-execution-worker.ts:150,198-223`）。修：recoverExpired 进每轮 drain；心跳失败先重试 N 次。
- **P1-2 租约丢失恢复时副作用工具重复执行竞态**（`agent-execution-runner.ts:205-207`、`tool-runner.ts:274-316`）。修：in-flight 工具先按 TOOL_EXECUTION_OUTCOME_UNKNOWN 终态化，恢复前确认旧 worker 已停。
- **P1-3 断连后推理继续烧钱、无整体超时、工具无统一超时**（`chat/route.ts:57`、`response-stream.ts:79-82`、`tool-executor.ts:7`）。修：run 整体 deadline；response-stream cancel 接 AbortController；tool-runner 外层统一超时。
- **P1-4 循环内工具结果注入不截断**，prelude 16k 截断与循环不一致（`agent-loop.ts:166-169` vs `orchestrator.ts:332-335`）。修：统一截断/摘要策略 + 循环内总预算。
- **P1-5 重试后事件回放内容重复**（旧/新 attempt 文本拼接，`durable-agent-runtime.ts:442-467`、`durable-response-stream.ts:58-76`）。修：回放按最新 attempt 过滤或发 attempt_reset。
- **P1-6 无"每对话单执行"并发护栏**（`chat/route.ts:69-83` 幂等只按 clientRunKey）。修：conversation 唯一活动执行约束 + dispatch 前等待旧执行终态。
- **P1-7 Provider 4xx 被当可重试，成本×3**（`agent-execution-runner.ts:212-227`、`runtime.ts:1313-1345`）。修：400/401/402/422 fail-fast，仅 429/5xx/网络可重试。
- **P1-8 失败/取消的 durable 留下空 assistant 消息连坏后续请求**（`prisma-agent-execution-store.ts:168-178`、`durable-agent-runtime.ts:541-548`）。修：任何终态补齐占位消息。

### P2（后续批次）

- P2-1 工具顺序执行：`agent-loop.ts:119-184`，只读工具可做有界并发。
- P2-2 maxRounds 固定 8：`agent-loop.ts:70`，profile 限额未传入主循环。
- P2-3 取消即删消息：`runtime.ts:1531`，应落"已取消"占位。
- P2-4 审批等待 SSE 长连接不收敛：`event-replay.ts:99-107` 无限轮询，应回 paused 终态。
- P2-5 审批过期兜底只覆盖 durable：非 durable pending_approval 无 reconcile。
- P2-6 用户审批偏好缓存无 TTL：`policy-engine.ts:106-124`。
- P2-7 MiniMax 手动联网预取失败 500 整单：`runtime.ts:778-786`，应降级。
- P2-8 approve 请求内同步执行工具且无 signal：`approve/route.ts:294-304`，应只排队交 worker。
- P2-9 运行时事件出口 cancel 不传播：`runtime.ts:319-321`，统一 AbortController。

---

## 第二部分：RAG / 文档解析问题清单

### P0

| # | 问题 | 证据 |
|---|---|---|
| R-P0-1 | **关键词检索排序与相关性无关**：LIKE 匹配后按 fileAssetId+chunkIndex 取前 12 条，fileAssetId 是随机 cuid → 无 embedding 时 top-k 近似随机 | `src/lib/rag/vector-store.ts:630-645` |
| R-P0-2 | **向量腿静默降级**：embedding 失败被吞、无 bailian key 永不嵌入，hybrid 静默退化为劣化关键词，文件仍显示 parsed | `src/lib/files/parse-job.ts:147-159`、`src/lib/rag/embedding.ts:264,299-313`、`vector-store.ts:445-448` |
| R-P0-3 | **"总结全部课件"只读每份文件第一个 chunk**（chunkIndex:0） | `vector-store.ts:950-969,671` |
| R-P0-4 | **RAG 双轨制**：新编排路径的 Agent 检索工具是纯关键词 MVP（数词频、250 字符片段、无向量），宣传的 RRF 只存在于旧路径 | `src/lib/tools/knowledge/project-rag.ts:1-24`、`runtime.ts:418` |
| R-P0-5 | **file.read 无翻页**：`text.slice(0, maxChars)` 硬截断，长文档只能读开头 | `src/lib/tools/project-files/read.ts:26` |

### P1

- 页码锚点从未被任何 parser 填充（`chunk-builder.ts:68-69` 声明 vs parser 均不赋值）；引用只能到文件级（`src/lib/agent/sources.ts:3-13`）。
- heading 独立成块丢章节上下文；表格/公式独立成块（`chunk-builder.ts:49-106`）。
- "总结全文">8000 字符静默降级（`vector-store.ts:43,918-933`）。
- 60k 上下文硬截断无标记，truncated 只进 debug（`vector-store.ts:1086-1101`、`runtime.ts:427,446`）。
- 勾选未解析文件被静默忽略；PATCH 编辑/知识增强后不重嵌入、不刷新索引缓存（`api/files/[id]/route.ts:167-175`、`api/files/enhance/route.ts:93-106`）。
- 无 query rewrite、无 rerank；category 不参与过滤；agentic 选文件上限 12。
- MiniMax PDF 单次 16k token 输出无截断检测、图片全跳过视觉分析（`vision/minimax.ts:129`、`minimax-pdf-parser.ts:37-42`）。
- 图片过滤关键词一票否决误删内容图（`image-filter.ts:86-99,197-200`）。

### P2/P3

- 图片 summary+OCR 双 chunk 重复；本地图 fusion embedding 因资源 URL 需登录必然 401 回退。
- pgvector 无 HNSW 索引全表扫描；嵌入串行批量；资源替换非原子；job-runner 无并发控制与退避；tokenCount 按字符/2 低估中文。

---

## 第三部分：外部参照 —— pi-agent 与 DeepSeek Harness 借鉴清单

### pi-agent = earendil-works/pi（Pi Agent Harness）

身份：MIT、TS monorepo（pi-ai → pi-agent-core → pi-coding-agent），作者 Mario Zechner。本地克隆 `course-ai-lab/pi`（c6d83715），LumenLab 已通过 `@earendil-works/pi-ai@0.80.7` 用作供应商适配层（`src/lib/agent/adapters/pi-ai-adapter.ts`）。

**适配层已落地、应固化的 6 个模式**：Transport 注入 + fake transport 全契约测试；provider×status 中文错误映射表；usage/cache 如实映射（未报告记零）；取消不记为成功；适配层无策略（maxRetries:0）；供应商差异在适配层消化（工具名编码）。

**pi 本体可继续借鉴（按性价比）**：① 压缩三触发（手动/token 阈值/溢出自动恢复）；② SSE 补 tool_execution_start/update/end 事件；③ 结构化工具结果 content/ui 分离；④ stopInstruction 收尾轮协议（已有，推广为通用契约）；⑤ shouldStopAfterTurn/terminate 平滑停止；⑥ 按需加载技能/资料；⑦ 跨 provider 切换保持上下文 + 会话树条目语义。

**不借鉴**：MCP、多智能体、内置 RAG、auth.json 凭据存储。

### DeepSeek Harness 最值得学的 5 个机制

1. **事件日志唯一事实源**（"模型可见 ⟺ 已落日志"不变量，`packages/core/session/src/types.ts`、`agent-loop/src/agent.ts`）。
2. **工具执行流水线 + 结构化错误协议**（isError+code，取消补发终态，call/result 永远配对，`packages/core/tools/src/index.ts`）。
3. **协作式取消/超时**（工具声明 timeoutMs 不进模型 schema，AbortSignal 贯穿，`packages/guard/timeout-policy/src/index.ts`）。
4. **flush-before-side-effect 语义 checkpoint**（`packages/session/session-checkpoint-policy/src/index.ts`）。
5. **双触发压缩 + CONTEXT_WINDOW_EXCEEDED 恢复重试**（`packages/compaction/compaction-basic/src/index.ts`）。

低垂果实：repeat-tool-reminder 防死循环、max-tokens sticky、SSE 转发白名单、JSONL 快照回放测试。

---

## 第四部分：实施路线图

### 第一批（本次开工，2026-08-14 起）——已全部完成，见 `docs/agent-iteration-plan-2026-08.md`

1. **落地页文案**：`landing/hero-section.tsx:103`、`landing-footer.tsx:29`「凭注册码使用」→「邮箱注册即可使用」（注册已改邮箱验证，`validators.ts:36`）。
2. **P0-1 token 用量逐轮累计**（agent-loop + runtime + durable）。
3. **P0-2 真压缩**（buildCompressedMessages 丢旧消息 + compact/runtime 落库标记 + loadHistory 过滤）。
4. **P0-3/P0-4 审批续跑闭环**（durable 断点恢复 + 非 durable approve 后自动续跑）。

### 第二批

5. RAG 地基：关键词真实打分（BM25/tsvector）、向量腿缺失可见化、corpus-wide 预算化采样、file.read 加 offset、页码锚点补全。
6. P1-1/P1-2 租约生命周期与副作用幂等。
7. P1-3 工具统一超时 + 断连 N 分钟自动软停止；P1-4 循环工具结果截断；P1-7 4xx fail-fast；P1-8 终态占位消息。

### 第三批

8. query rewrite / rerank；chunk heading 上下文注入；enhance/PATCH 后重嵌入；SSE 工具事件时间线；并发护栏；DSH 事件日志改造评估。

---

## 第五部分：宣传物料审查结论（任务1 存档）

- 9 张卡片 + Bento + 封面存在大量行业黑话：pgvector/RRF/SSE/MinerU/多模态 RAG/上下文对话/学习闭环/Agent 平台/知识图谱/检索，与「面向大众」定位不符；「知识图谱」是对实际功能（知识点地图/资料图谱）的过度承诺。
- 定位四分五裂：朋友圈「在线类Agent平台」/ 落地页「大学生 AI 学习工作台」/ 封面「为学习与项目而生的 AI 工作台」/ 09 卡「面向大学计算机课程的 AI 工作台」——需收敛为一句统一定位。
- **落地页「凭注册码使用」与邮箱注册流程矛盾，是 A 测零使用的直接嫌疑点（列入第一批修复）。**
- 传播结构：朋友圈建议 Bento 单图 + 3 张最强截图，第一张放用户故事与可扫二维码；文案改写版本见对话记录。
