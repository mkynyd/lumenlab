# 任务路由

> 面向开发者与自托管维护者，介绍 LumenLab 如何选择 DeepSeek V4.1 Flash、MiniMax M3 或 Qwen3.8-Flash，以及 Tool / Skill 在不同模型上的分发策略。

## 模型路由入口

模型选择规则集中在 `src/lib/chat/router.ts` 的 `routeModel()`，调用者已经收敛到 `AgentRuntime`，而不是 HTTP Route：

1. **Preflight 校验**：`src/lib/agent/runtime.ts` 在创建新对话前按同一套规则判定目标 provider，并校验该用户是否有可用 API Key；缺少密钥直接返回 `403`，不会创建空对话。
2. **对话内路由**：后续消息按同一函数解析；`conversation.modelLock` 只作为旧会话的只读兼容，新会话不再写锁。

`src/app/api/chat/route.ts` 不感知具体模型、模型锁或凭证，只负责鉴权、限流、请求映射、调用 `AgentRuntime.run()` 和返回 SSE。`GET /api/chat/models` 依据服务端灰度开关、百炼工作空间和当前用户凭据返回实际可选模型，前端不直接读取发布开关。

## 路由规则（按优先级）

| 优先级 | 条件 | 结果 | 是否写入 modelLock |
|---|---|---|---|
| 1 | 用户显式选择某活跃模型 | 该模型的 provider | 否 |
| 2 | `conversation.modelLock === "qwen"`（旧会话） | Bailian Qwen | 否（只读兼容） |
| 3 | `conversation.modelLock === "minimax"`（旧会话） | MiniMax | 否（只读兼容） |
| 默认 | 以上都不满足 | 默认模型所在 provider | 否 |

说明：

- 任务 05 起附件不再影响路由：三个活跃模型都能读图，因此 `requiresVisionModel` 与「多模态附件锁定 MiniMax」的行为都已删除，`shouldLock` 恒为 `false`。
- 旧会话保存的模型在发起新回合时按目录升级：`deepseek-v4-flash`、`deepseek-v4-flash-vision-exp`、`deepseek-v4-pro` → `deepseek-flash`，`qwen3.7-plus` → `qwen3.8-flash`；未知 ID 原样保留并明确失败。
- 未启用 `MODEL_QWEN_ENABLED`、未配置 `BAILIAN_WORKSPACE_ID` 或当前账号缺少 Bailian 凭据时，Qwen 不会出现在模型目录中，直接提交该模型也会被服务端拒绝。

## Preflight API Key 校验

在创建新对话前，`AgentRuntime` 会调用 `getProviderApiKey(userId, provider)`：

- 若系统处于自托管模式（`USER_API_KEYS_ENABLED=1`），优先查找 `ApiKey` 表中该 provider 的密钥。
- 否则使用中央凭证模式，通过 `CredentialProfile` / `ProviderCredential` 获取对应 provider 的加密切片。
- 若目标 provider 无可用密钥，直接返回 `403`，不会创建空对话。

## 历史消息与思考过程

任务 05 已删除 MiniMax 专用的历史压缩（`summarizeHistoryForMiniMax()`）。当前所有 provider 共用同一条 Responses 消息组装路径：`src/lib/agent/providers/responses/adapter-stream.ts` 的 `prepareResponsesMessages()` 会从历史消息中统一删除 `reasoning_content`，只保留正文与当前回合的媒体引用，因此跨模型切换时不再需要按 provider 压缩历史。

普通会话的上下文长度由 `src/lib/chat/compression.ts` 的会话压缩负责，与模型路由相互独立。

## Skill Router

`src/lib/agent/skill-router.ts` 由 `AgentRuntime` 调用，根据用户输入、隐藏快捷任务提示、手动 Skill、历史 active Skill、项目上下文、选中文件和联网意图返回：

- `activeSkillId`：当前激活的 Skill。
- `status`：`none` / `active` / `awaiting_context`。
- `source`：手动选择、规则命中或无 Skill。
- `profile`：`simple` / `rag` / `research` / `workflow`。
- `webAccessRecommended`：是否建议启用联网。
- `suggestions`：可在前端展示的替代 Skill。

路由优先级：

1. 手动选择 Skill 或手动关闭 Skill。
2. `.lumenlab/skills/*/policy.json` 中的 `triggers.include/exclude`。
3. 兼容旧行为的硬编码关键词 fallback。
4. 无命中时保持通用对话。

## Tool 分发

不同模型的 Tool 协议差异被限制在 `src/lib/agent/adapters/`。`AgentLoop` 只接收统一的 `NormalizedToolCall`，不会解析厂商原生 block、工具别名或 fallback 标记。

### DeepSeek

- `DeepSeekAdapter` 把内部 `web.search` 映射为 `web_search`，其余 Tool ID 使用可逆编码满足 Responses 名称限制；返回时全部还原为内部 Tool ID。
- 所有活跃 Tool 都以原生 `function_call` / `function_call_output` items 续接并按 call_id 区分，不再注入或解析 XML/DSML。
- `new` 模式还可在首轮模型回答前执行确定性工具前奏，如 `project_files.read`、`project_rag.search`、`web.fetch`；前奏和模型触发调用共用 `ToolRunner` 与去重记录。

### MiniMax

- `MiniMaxAdapter` 将当前允许的 Tool 作为原生 Tool 注入，解析原生 `tool_use`，并用原生 `tool_result` transcript 续跑。
- continuation 不重复携带首轮图片/PDF 等附件，历史中的 DeepSeek reasoning 也会在 Adapter 边界过滤。
- MiniMax 同样使用 Responses 原生 function items，并在 Adapter 边界处理工具名编码。

### Qwen3.8-Flash

- `BailianQwenAdapter` 使用百炼 compatible-mode Responses，文本增量、reasoning、usage 和 Tool call 都规范化为 Runtime 内部事件。
- 图片使用 data URL；视频附件由 `src/lib/agent/adapters/bailian-qwen-native.ts` 委托 DashScope 原生端点处理。

### Provider Adapter 选择

- `src/lib/agent/adapters/index.ts` 的 `resolveProviderAdapterLayer()` 只区分 `responses`（默认）、`legacy` 与 `pi`。
- `legacy` 只是项目自有 Adapter 的配置别名，与 `responses` 走同一条实现。
- `pi` / `pi-ai` 已不可用于当前活跃模型：命中该配置会直接抛出配置错误，不会静默降级。

### 统一 Tool loop

`src/lib/agent/loop/agent-loop.ts` 负责 allowlist、跨前奏去重、无进展检测、最多轮次、取消信号和 Provider continuation；具体 Policy、审批、执行、审计与 `ToolExecution` 状态转换由 `ToolRunner` 负责。审批出现时 loop 进入 `awaiting_approval`，不会向 Provider 伪造“已跳过”结果。

### 百炼 Embedding

- RAG 入口在 `src/lib/rag/embedding.ts`，调用 `embedQuery()` 把查询文本转成 1024 维向量。
- Qwen 聊天与向量检索都使用 `bailian` provider 凭据，但调用不同端点：聊天由 `BailianQwenAdapter` 发往工作空间端点，embedding 使用独立的向量接口。
- embedding 失败时系统降级为纯关键词检索，不会阻塞普通对话；Qwen 聊天不可用时则从服务端模型目录隐藏。

## 相关文档

- Provider 适配边界：见 `src/lib/agent/provider-adapter.ts` 与 `src/lib/agent/adapters/`
- Tool 调用后的审批与执行：见 [Policy Engine](./policy-engine.md)
