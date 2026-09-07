# light-ai-chat 交接

> 2026-09-07 · GPT-6 · Codex（最新）｜Kimi · Kimi Code（前两阶段）
> 范围：260907 迭代。任务 01 已提交 `22e5b19`；任务 02 DeepSeek Vision 代码收口已提交 `2af313e` 并推送 main。仍未部署。

## 最新：任务 02 — DeepSeek Vision 路径收口

- 删除 `deepseek.ts` 中无人调用的 Anthropic 流式实现；流式聊天由 `DeepSeekAdapter` 唯一接入 Responses，非流式继续复用 `postResponses`。源码业务范围已无 DeepSeek Anthropic 请求入口。
- DeepSeek 全部平台 Tool 现以 Responses `function_call` / `function_call_output` 续接：`web.search` 保持 `web_search` 映射，其余 Tool ID 可逆编码，按 call_id 回放；不再注入、解析或生成 XML/DSML fallback。
- 显式模型选择现在优先于旧 `modelLock` 与附件自动路由，选择 `deepseek-v4-flash-vision-exp` 携带图片时仍走 DeepSeek；PNG/JPEG/WebP 在 multipart HTTP 边界核对扩展名、真实文件签名与规范 MIME 后才进入 data URL。
- `web.search` 改为平台直接执行 Bing RSS → DuckDuckGo HTTP 检索，相关性闸门与来源卡片保持；移除无法在嵌套 `completeChat` 中执行的伪 server-tool 往返，模型只通过受审计的 function output 消费可验证搜索结果。
- 本地全量门禁通过：267 个文件 / 1586 项、TypeScript、ESLint、production build、diff check 全绿；构建仍只有既有 CSS `--color-*` warning，测试仍有 jsdom canvas 提示。远端 [GitHub Actions run 34136320494](https://github.com/mkynyd/lumenlab/actions/runs/34136320494) 的 macOS lockfile 通过，但 Linux `npm test` 因 `src/app/(auth)/register/page.test.tsx` 单项 5 秒超时失败（266 文件 / 1585 项通过），需后续修复/重跑。真实 DeepSeek 文本/图片/工具账号验收因本机无凭据未执行；管理端凭证探针按方案留给 04，未部署。

## 前次：任务 01 第五阶段 — 非流式 Responses 调用

- `createTextMessage` / `completeChat` 保持原调用签名，内部改用共享 `postResponses` + `buildDeepSeekResponsesBody`，固定发往 `https://api.deepseek.com/responses`；旧 DeepSeek ID 和未知别名统一升级为活跃 `deepseek-v4-flash-vision-exp`。
- 非流式响应兼容顶层 `output_text` 与 message/output_text items，reasoning 和 usage 走公共映射；completed 才成功，incomplete/failed/refusal/空正文全部 fail closed，HTTP 状态与上游错误详情继续映射为 `DeepSeekError`。
- 摘要、标题、资料索引、学习模型网关、快捷任务、搜索封装等 8 个既有封装调用方自动迁移；另清除 `classification.ts` 中项目提示词、用户画像、快捷推荐的 3 处 DeepSeek Anthropic 直连旁路。业务范围内已无 DeepSeek Anthropic 非流式直连。
- 任务 01 整体门禁通过：267 个文件 / 1590 项、TypeScript、ESLint、production build、diff check 全绿；构建保留既有 CSS `--color-*` warning，测试保留 jsdom canvas 提示。真实 provider 验收仍因本机无凭据未执行；尚未部署。
- 01.11 durable 图片重新鉴权/加载仍随任务 08 附件入口实现；当前不会把请求内 Buffer 或供应商私有引用写入 checkpoint。
- 任务 01 提交 `22e5b19` 已推送 main，[GitHub Actions CI](https://github.com/mkynyd/lumenlab/actions/runs/34134493736) 的 Linux 全门禁与 macOS lockfile 均通过。

## 前次：任务 01 第四阶段 — Checkpoint v2 与恢复语义

- 新执行写 v2：受限 message/function_call/function_call_output items，文件只允许平台 `fileAssetId + contentFingerprint` 引用；继续执行前读取 v1 并升级，旧 DeepSeek/Qwen ID 同步升级为实际活跃模型，结算使用实际模型。
- 审批暂停从 ToolExecution 回读原始 provider call_id、规范化参数和结果，恢复时结构化回放 tool_use/tool_result；跳过 deterministic prelude，并用已完成调用保护副作用。工具持久层改为优先按 provider call_id 去重，同名同参但不同 call_id 不再合并。
- 流中断/取消时将已产生正文、推理与已观测 usage 写入 `partialOutput`；成功输出清理 partial，累计 usage 只结算一次。v2 仍受 2MB、严格 schema、JSON 可序列化和敏感/provider-private key 拒绝约束。
- 全量 267 文件 / 1584 项、TypeScript、ESLint、production build、diff check 通过；构建保留既有 CSS `--color-*` warning。未做真实账号模型、审批 UI/Worker 重启 E2E 或部署。
- 01 下一步：重跑任务 01 整体门禁并核对剩余发布阻断。图片 checkpoint 的资源重新鉴权/加载仍随任务 08 durable 附件开放完成，当前没有放开附件 durable 入口。

## 前次：任务 01 第三阶段 — 三家 Responses 文本/图片适配器已接入

> 2026-09-07 · GPT-6 · Codex。main / origin/main = `f7fc810`。保留前两阶段所有未提交改动；任务 01 尚未整体完成，按原交接在整体门禁通过后再 commit/push，当前不可部署。

### 本阶段实现

- 新增 `src/lib/agent/providers/responses/adapter-stream.ts`：三家共用 HTTP/SSE 传输与累积器，输出保持 `ProviderAdapter` / `ProviderStreamEvent` / 应用 model-delta SSE 合同。DeepSeek 使用 `https://api.deepseek.com/responses`，MiniMax 使用 `https://api.minimax.cn/v1/responses`，Qwen 使用既有工作空间的 `/compatible-mode/v1/responses`。
- DeepSeek 保留客户端 `web.search → web_search` 与 XML/DSML fallback；MiniMax/Qwen 原生工具名进行可逆编码（解决点号不被接受且避免下划线碰撞），Qwen 每个结果紧跟配对的 function_call。native 调用按 call_id 去重，不吞掉同名同参但不同 ID 的调用；prelude 和 XML 的现有参数去重保留，身份持久化仍待 Checkpoint 阶段。
- 图片保留在原始 user 消息的请求内存字段，在工具续接时回放原图，避免丢失上下文或附到工具结果上。未开放 durable 附件入口，未保存 Buffer、签名 URL、供应商 file_id 到 Checkpoint；跨请求图片持久化仍属 08。
- 流累积改为按 item/content 分片处理 done，支持终态 output 补齐缺失文本、output_index 与 item_id 绑定、拒绝与不完整工具检测。完成/截断/失败/拒绝可区分；非成功终态拒绝成功完成且不开放工具执行。终态 usage 只归一一次，缺少缓存测量时保持缺省，不伪造命中 0。
- 修复无工具 AgentLoop 跳过流消费的问题：普通聊天也实时转发内容并等待上游终态。HTTP 4xx/429 通过 Runtime 映射；取消保留 AbortError，超时保留 ResponsesTimeoutError。
- 默认协议配置改为 `responses`，`legacy` 是兼容别名；旧 Pi POC 无法绕过目标模型配置。`AGENT_RESPONSES_DEEPSEEK_ENABLED` / `MINIMAX` / `BAILIAN` 设为 false 可独立暂停，返回 503，不自动回退到未验证协议。

### 官方文档纠正（本轮在线复核）

- [DeepSeek Responses 参数](https://api-docs.deepseek.com/zh-cn/api/create-response/)：不传 reasoning 默认开启，关闭必须显式 `effort:none`；已修正前次 builder。
- [MiniMax Responses](https://platform.minimaxi.com/docs/api-reference/responses-create)：目标端点 `/v1/responses`、MiniMax-M3 显式开启 reasoning；仍不能拿旧 Anthropic PDF document schema 直接发 Responses。
- [百炼 Responses 参数](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-responses)：支持 `store:false`，**明确不支持视频/语音输入**。已设置 store:false、移除假设的 input_video、将当前目录输入范围收窄为 text/image。已有视频暂时明确报错；**04 必须恢复已验证的视频兼容路径，此项未完成，不能据本阶段发布**。不得沿用前次交接中“视频签名 URL 换成 input_video”的设计。

### 验证与剩余边界

- 全量 `npm test`：267 个文件 / 1579 项通过；TypeScript、ESLint、production build、git diff check 通过。构建有一条 CSS `--color-*` token 优化 warning，测试输出一次 jsdom canvas 提示，均未失败；本轮未修改 CSS。
- 测试覆盖真实适配器 + 模拟 fetch/SSE、文本/图片/工具续接、不同调用身份、无工具实时流、EOF、截断/拒绝/失败、HTTP 429、取消，以及既有 Runtime/Policy/持久化回归。路由测试已改为 mock 适配器 stream 并禁止未模拟网络；未进行有真实权限的模型调用或 UI E2E，不能把合同测试当线上验收。
- 下一步仍在 01：Checkpoint v2 / v1 读取升级、旧模型在请求与计费一致升级、审批恢复不重放副作用；同时补齐工具循环中断后部分输出/费用持久化（当前错误已阻止成功发布，但该持久化链路尚未完整）。之后迁移 01.9 的 createTextMessage/completeChat 与 8 处调用方，重新跑 01 整体门禁。
- PDF/Word 聊天输入仍待 03；视频兼容、账号地域/价格/模型权限与管理端探针待 04；Chat/Project 图片直传路由退场工作仍待 05。当前只完成适配器文本/图片合同接入，不代表 01—05 完成。

## 前两阶段进度

### 已完成：第一阶段 — Responses 合同层（新目录，未接入现有代码）

新建 `src/lib/agent/providers/responses/`，零现有文件改动：

- `types.ts` — wire 类型：input item（message / function_call / function_call_output / reasoning）、content part（input_text / output_text / input_image / input_video）、请求体（刻意不含 store / previous_response_id）、流事件信封、`ResponsesUsage`（cached_tokens / reasoning_tokens 细分）。
- `transport.ts` — 唯一 fetch 传输：`streamResponses`（SSE 异步序列）与 `postResponses`（非流式，供 01.9）；跨 chunk 半行缓冲、多 data 行拼接、`[DONE]` 容忍、EOF 尾事件冲刷；`ResponsesHttpError`（429/5xx retryable + Retry-After）、`ResponsesTimeoutError`、`ResponsesStreamInterruptedError`（network / eof_without_terminal）；`fetchImpl` 注入缝供测试。
- `serialize.ts` — `messagesToInputItems`（system→instructions、tool_use→function_call、tool_result→function_call_output、附件图片→末条 user 的 input_image data URL；**PDF/Word 显式抛 `ResponsesSerializationError` + TODO-03 标记**，任务 03 再处理）；`mapResponsesUsage`（reasoning_tokens 只展示不计费，缺 cached 明细不伪造）；`ResponsesStreamAccumulator`（done 只在 startsWith 已累积时补后缀、divergent 保留 delta、function_call 按 item_id/output_index 累积且同 name/args 不同 call_id 都保留、终态 completed/incomplete/failed/refused 可区分、finish() 无终态抛中断）；`normalizeResponsesStream`；三家 builder `buildDeepSeekResponsesBody` / `buildMiniMaxResponsesBody` / `buildQwenResponsesBody`。
- 测试：`transport.test.ts` 14 项、`serialize.test.ts` 15 项、`accumulator.test.ts` 19 项，共 48 项全绿（假 SSE/假 fetch，无真实网络）；`tsc --noEmit` 零错误；eslint 零告警。

### 第一阶段落地的三家差异

- DeepSeek：`instructions` + thinkingEnabled 时 `reasoning:{effort}`（high/max 透传）；不发 store/previous_response_id；web_search 保持客户端 function 工具（不用内置类型，避免双调用）。
- MiniMax：始终显式 `reasoning`（默认 none，thinking 时必须非 none，内部 high/max→medium/high）；temperature/top_p 钳到 (0,1]；tool_choice 仅 none/auto。
- Qwen：`reasoning.effort` 默认 medium（max→high）；不发 previous_response_id；视频 `input_video` 的签名 URL 替换留给 adapter 阶段。

### 已完成：第二阶段 — 结构化模型目录（01.1）+ 计费峰谷与未知模型阻断

模型目录（`src/lib/chat/model-catalog.ts` 重写，保留原导出签名）：

| 内部 ID | wire ID | provider | 输入类型 | 上下文/输出上限 | reasoning 映射 | enabled |
|---|---|---|---|---|---|---|
| deepseek-v4-flash-vision-exp | 同左 | deepseek | text, image | 1M / 384K | high→high, max→max | 是 |
| minimax-m3 | MiniMax-M3 | minimax | text, image | 1M / 128K | high→medium, max→high | 是 |
| qwen3.8-flash | 同左 | bailian | text, image, video, audio | 1M / 64K | high→medium, max→high | 是 |
| deepseek-v4-flash / deepseek-v4-pro / qwen3.7-plus | 同左 | — | 历史别名 | — | — | 否（保留映射与标签，新请求不发） |

- 新增 `LEGACY_CHAT_MODELS`、`CatalogModelId`、`MODEL_CATALOG` / `getModelCatalogEntry` / `isActiveChatModel` / `providerForChatModel` / `chatModelLabel`、`MODEL_BILLING_VERSION = "2026-09-07"`；历史标签、TokenUsage、已结算账单一律不改写。
- 消费方同步：`contracts.ts`（AgentModel→CatalogModelId）、`agent-execution-store.ts` durableRequestSchema 枚举含历史别名、`runtime.ts:251` 与 `durable-agent-runtime.ts` 的 provider 映射、`router.ts` 两处按目录 provider 路由、UI（model-selector / chat-input / use-chat / usage 页 / projects 页）。
- 计费（`credits.ts`）：新增 `deepseek-v4-flash-vision-exp` 峰谷两档（低谷 hit 0.05/miss 1.5/out 4.5；高峰 0.1/3/9 元每百万）与 `qwen3.8-flash`（0.1/0.8/2.7，不沿用长上下文档位）；`minimax-m3` 与历史模型权重不变。`deepSeekBillingTier(at)`：Asia/Shanghai 周一至五 9-12、14-18 高峰，周末全天低谷；`calculateCredits`/`estimateCreditsForBudget` 增 `requestStartedAt`，**按请求开始时间冻结档位**（runtime 传 runStartedAt、durable 传 execution.createdAt、agent-run-metrics 传 startedAt，无一处用当前时间）。**未知模型结算抛 `UnknownModelCreditError`**；历史读取路径不抛。浮点加 1e-6 精度舍入（有专项测试）。
- 测试：`model-catalog.test.ts` 重写 8 项、`credits.test.ts` 扩至 22 项（峰谷边界 8:59/9:00/11:59/12:00/13:59/14:00/17:59/18:00、周末、UTC 注入验证时区、跨边界冻结、未知模型抛错、浮点精度）；夹具更新 validators/route/request-mapper/model-selector 测试。**全量 `npm test` 266 文件 / 1542 项全绿**；`tsc --noEmit`、eslint 零告警。

第二阶段当时的遗留注意点（当前已修正部分以上文第三阶段为准）：

1. **main 处于不可部署的中间态**：目录已切活跃模型，但 adapter 未迁移——DeepSeek adapter 会把 `deepseek-v4-flash-vision-exp` 透传到旧 Anthropic 端点；`BailianQwenAdapter` 对非 `qwen3.7-plus` 显式抛错（Qwen 聊天暂不可用）；`mapDeepSeekModel` 仍回落旧 flash（留给 01.9）。第三阶段 adapter 迁移即解决。
2. minimax-m3 输出上限 128K、qwen3.8-flash 1M/64K 为文档缺失下的假设值（代码注释已标注），任务 03/04 核对官方文档后修正。
3. 省略 `requestStartedAt` 时 DeepSeek 按低谷计价（确定性缺省，已在 credits.ts 注释说明）。
4. 旧会话留存的旧模型 ID 会被 sendMessageSchema 拒绝；前端选择器只列活跃模型。

### 待做阶段（设计仍以下方「任务 01 实施设计」为准，已落地部分以代码为准）

1. ~~模型目录 01.1~~（已完成，见上）
2. 三个 adapter 的文本/图片 Responses 接线已完成（本阶段）；视频/PDF 暂不支持，不能据此完成整个迁移。
3. ~~Checkpoint v2（01.10）~~ 已完成；图片资源重新鉴权与 durable 附件开放仍属 01.11 / 08。
4. ~~credits.ts~~（已完成，见上）
5. ~~非流式 01.9~~ 已完成：`createTextMessage`/`completeChat` 与 classification 三处直连均改走 `postResponses`；`mapDeepSeekModel` 指向 vision-exp。
6. ~~全量本地验收~~ 已完成；按仓库规范提交并推送，生产部署仍需用户另行明确授权。

## 前次核查结论（仍有效，代码事实以当前源码为准）

1. 内部消息合同是 `DeepSeekMessage`（role + string/ContentBlock），三家 adapter 都消费它；`ProviderStreamEvent` 只有 `text_delta | reasoning_delta | usage`，工具调用靠 adapter 缓冲后 `getToolCalls()` 提供，loop/持久化/SSE 全部不受协议影响。
2. DeepSeek 走 Anthropic SDK（`https://api.deepseek.com/anthropic`，thinking 只认 enabled/disabled，web.search 是**客户端 function**，`supportsNativeTool` 仅认 `web.search`，其余工具走 XML/DSML fallback）。
3. MiniMax 走 Anthropic SDK（`https://api.minimaxi.com/anthropic`），附件以 base64 image/document 块注入最后一条 user 消息；Responses ContentPart **没有 document 类型**，PDF/Word 需替代输入（任务 03）。
4. Qwen 走 DashScope 原生 multimodal-generation（`qwen3.7-plus`），媒体经 `DashScopeMediaResolver`（图片 base64、视频上传七牛取签名 URL 后清理）。
5. Checkpoint v1 只允许 role+字符串 content、2MB 上限、`durableRequestSchema` 硬编码 4 个旧模型；工具项完全不在 checkpoint 里，靠 `pendingToolCall` + 审批恢复消息延续。
6. `calculateCredits` 对未知模型返回 0（credits.ts:78）；DeepSeek 现权重无峰谷区分。
7. 直接调用 DeepSeek 客户端的非流式调用方共 8 处：quick-actions/generate、conversations title、files enhance、web/search-engine、learning/model-gateway、chat/compression、rag/project-index、rag/vector-store（`createTextMessage`/`completeChat`）。
8. durable 入口在 `src/app/api/chat/route.ts:61` 以 `parsed.attachments.length === 0` 排除附件请求（任务 08 处理，本轮不动）。
9. `.env` 存在但未含三家 API key 明文；**真实模型调用验证无法在本机执行**，验收以合同测试 + lint + tsc + 全量测试为准。
10. 依赖已有 `openai@6.42.0`、`pdfjs-dist`；无需新增依赖。

## 任务 01 实施设计（后续阶段照此落地；第一阶段已按此完成）

新建 `src/lib/agent/providers/responses/`（已完成，见上）：

- `types.ts`：Responses wire 类型（input item：message/function_call/function_call_output/reasoning；content part：input_text/output_text/input_image(+video)；stream 事件；usage：input_tokens+cached_tokens / output_tokens+reasoning_tokens）。
- `transport.ts`：唯一 fetch 传输——POST `{baseUrl}/responses`，Bearer、超时、AbortSignal 转发、SSE 逐行解析（`data:` 行、无 `[DONE]`、跨 chunk 缓冲）、4xx/429 错误映射；产出原始事件 JSON 异步序列。合同测试用注入的假 SSE 流。
- `serialize.ts`：`DeepSeekMessage[]`+附件 → items（附件图片 = 最后一条 user 消息的 `input_image` data URL；PDF/Word 仍按现行为，任务 03 再改）；流事件累积器——text/reasoning delta 全文清洗切片、**done 只补缺失片段不重复拼接**（01.5）、function_call 按 item_id/output_index 累积 arguments、`response.completed/incomplete/failed` 归一为终态+usage，**EOF 无终态 = 中断错误不伪装成功**（01.6）。
- 三家 serializer 差异：DeepSeek `reasoning:{effort}`+`instructions`、无 store/previous_response_id（不发）、工具 `input_schema→parameters`、`{type:"function",name,parameters}`、web_search 保持客户端 function 不用内置（避免双调用，01.8）；MiniMax **reasoning 默认 none，thinkingEnabled 时必须显式传 effort 非 none**、temperature≤1、tool_choice 仅 none/auto、function_call_output 支持字符串或块数组；Qwen base URL 换 `…/compatible-mode/v1`、`qwen3.8-flash`、reasoning.effort 映射 medium 默认、不用 previous_response_id、视频继续走签名 URL `input_video`。

Adapter 层：三个 adapter 改为走 Responses transport，对外保持 `ProviderAdapter` 接口与 `ProviderStreamEvent` 不变 → loop/runtime/persistence/response-stream 零改动。`createProviderRound` 的 native 名单归一逻辑保留（DeepSeek web_search 名映射）。

模型目录（01.1）：扩展 `src/lib/chat/model-catalog.ts` 为结构化目录：内部 ID / wire ID / provider / 输入类型 / 上下文与输出上限 / reasoning 映射 / enabled / 计费版本；活跃 = `deepseek-v4-flash-vision-exp`、`minimax-m3`、`qwen3.8-flash`；历史别名 `deepseek-v4-flash`、`deepseek-v4-pro`、`qwen3.7-plus` 保留映射（历史标签/账单不改写，新请求不发旧模型）。`agent-execution-store.ts` 的 `durableRequestSchema` 枚举与 `runtime.ts:251-257` `providerForRequestedModel`、`router.ts:99` 同步更新。

Checkpoint v2（01.10，已完成；01.11 部分待 08）：schema `version: 2`，新增有上限的 `items`（标准化 function_call/function_call_output/消息项）与图片仅存平台 `FileAsset` 资源 ID/版本（禁止 Buffer、签名 URL、供应商 file_id）；`parseAgentCheckpoint` 接受 v1 并在新回合开始时转换；保存 call_id 与已完成工具结果，审批恢复不重放已落盘副作用。图片重新鉴权读取在 durable 附件入口开放时完成。

费用：credits.ts 增 `deepseek-v4-flash-vision-exp`（未命中 1.5/高峰 3.0、命中 0.05/0.10、输出 4.5/9.0，元/百万 → 权重 ×1/×3 档）、`qwen3.8-flash`（hit 0.1/miss 0.8/out 2.7，不用 Batch/显式缓存档、不沿用 qwen3.7 长上下文档位）；DeepSeek 峰谷按 Asia/Shanghai 周一至五 9-12、14-18，**按请求开始时间冻结计费档**（由 runtime 在回合开始算好档位传入，不按结算时刻重算）；未知活跃模型改为抛错阻止结算（历史已结算记录不重算）。minimax-m3 权重不变。

非流式调用（01.9）：`createTextMessage`/`completeChat` 保持签名、内部改走 Responses 非流式（读 output_text），8 个调用方即自动迁移；`mapDeepSeekModel` 返回值改为 vision-exp。

验收：合同测试覆盖 SSE 跨 chunk/多行、乱序保护、delta+done 去重、多 tool call、incomplete/failed、429/4xx、取消、usage 累计（第一阶段已覆盖）；checkpoint v1/v2 与审批恢复；`npm run lint`、`tsc --noEmit`、`npm test` 全绿后按仓库规范 commit + push（feat: ...）。

## 下一步顺序

01 剩余阶段（上述 1—6）→ 02 DeepSeek vision 迁移细节 → 03 MiniMax 文档输入替代 → 04 Qwen 目录/计费 → 05 原生多模态简化。02—05 依赖 01 冻结的合同；每步完成后更新本 HANDOFF、根 log.md、迭代目录 TODO.md 勾选项。

## 第一阶段历史边界

- 第一阶段未 commit、未接入 adapter，线上行为零变化；未运行真实模型调用，未部署。
- `REPOSITORY_INDEX.md` 为 gitignore 本地文件，已同步加入 responses/ 目录条目。
- `REPOSITORY_INDEX.md` 中 Research/Paper 章节是 feature 分支范围，main 上不存在这些路由，勿据此写代码。
