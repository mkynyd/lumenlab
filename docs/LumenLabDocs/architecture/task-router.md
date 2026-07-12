# 任务路由

> 面向开发者与自托管维护者，介绍 LumenLab 如何选择使用 DeepSeek、MiniMax 或百炼，以及 Tool / Skill 在不同模型上的分发策略。

## 模型路由入口

模型选择规则仍集中在 `src/lib/chat/router.ts` 的 `routeModel()`，但调用者已经收敛到 `AgentRuntime`，而不是 HTTP Route：

1. **Preflight 校验**：`src/lib/agent/runtime.ts` 在创建新对话前，根据附件、显式模型与 `ContextAssembler` 的视觉需求判定目标 provider，并校验该用户是否有可用 API Key。
2. **对话内路由**：后续消息若 `conversation.modelLock` 已设置，则沿用锁定 provider。

`src/app/api/chat/route.ts` 不感知 DeepSeek、MiniMax、模型锁或凭证，只负责鉴权、限流、请求映射、调用 `AgentRuntime.run()` 和返回 SSE。

## 路由规则（按优先级）

| 优先级 | 条件 | 结果 | 是否写入 modelLock |
|---|---|---|---|
| 1 | `conversation.modelLock === "minimax"` | MiniMax | 否（已锁定） |
| 2 | `requiresVisionModel === true` | MiniMax | 是 |
| 3 | 附件包含非文本内容（图片、PDF、Office 等） | MiniMax | 是 |
| 4 | 用户显式选择 `minimax-m3` | MiniMax | 否 |
| 默认 | 以上都不满足 | DeepSeek | 否 |

说明：

- `requiresVisionModel` 仅根据用户**显式选中**的文件判定；RAG 检索返回的是纯文本 chunk，不会触发视觉模型切换。
- 一旦因视觉或多模态需求锁定到 MiniMax，后续同一对话的消息继续使用 MiniMax，避免模型反复切换导致上下文断裂。

## Preflight API Key 校验

在创建新对话前，`AgentRuntime` 会调用 `getProviderApiKey(userId, provider)`：

- 若系统处于自托管模式（`USER_API_KEYS_ENABLED=1`），优先查找 `ApiKey` 表中该 provider 的密钥。
- 否则使用中央凭证模式，通过 `CredentialProfile` / `ProviderCredential` 获取对应 provider 的加密切片。
- 若目标 provider 无可用密钥，直接返回 `403`，不会创建空对话。

## 历史压缩

当对话从 DeepSeek 切换到 MiniMax 时，原始 DeepSeek 消息中的 `reasoningContent`（深度推理过程）对 MiniMax 无意义，且会占用大量上下文窗口。`src/lib/chat/router.ts` 中的 `summarizeHistoryForMiniMax()` 会：

1. 过滤掉 `role !== user/assistant` 的消息。
2. 仅保留最近 12 条。
3. 压缩为 12000 字符以内的纯文本摘要，作为系统上下文注入。

对应实现也位于 `src/lib/chat/history-adapter.ts` 的 `filterThinkingForMiniMax()`。

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

- `DeepSeekAdapter` 把内部 `web.search` 映射为厂商原生 `web_search`，并把返回名称映射回内部 Tool ID。
- 其他当前不支持原生调用的 Tool 由 Adapter 注入 XML/DSML 指令、解析 fallback 调用，并以文本工具结果构造 continuation；XML/DSML 标记不会泄漏到用户正文。
- 原生 Tool 与 XML/DSML fallback 可在同一轮归一化、按 Tool 名称与参数去重，然后交给统一 `AgentLoop`。
- `new` 模式还可在首轮模型回答前执行确定性工具前奏，如 `project_files.read`、`project_rag.search`、`web.fetch`；前奏和模型触发调用共用 `ToolRunner` 与去重记录。

### MiniMax

- `MiniMaxAdapter` 将当前允许的 Tool 作为原生 Tool 注入，解析原生 `tool_use`，并用原生 `tool_result` transcript 续跑。
- continuation 不重复携带首轮图片/PDF 等附件，历史中的 DeepSeek reasoning 也会在 Adapter 边界过滤。
- XML/DSML fallback 是 DeepSeek 兼容策略，MiniMax 不解析这种文本标记。

### 统一 Tool loop

`src/lib/agent/loop/agent-loop.ts` 负责 allowlist、跨前奏去重、无进展检测、最多轮次、取消信号和 Provider continuation；具体 Policy、审批、执行、审计与 `ToolExecution` 状态转换由 `ToolRunner` 负责。审批出现时 loop 进入 `awaiting_approval`，不会向 Provider 伪造“已跳过”结果。

### 百炼（Bailian）

- **仅用于 RAG embedding**，不用于聊天。
- 入口在 `src/lib/rag/embedding.ts`，调用 `embedQuery()` 把查询文本转成 1024 维向量。
- `AgentRuntime` 通过 `getProviderApiKey(userId, "bailian")` 获取百炼密钥；如果 embedding 失败，系统会降级为纯关键词检索，不会阻塞对话。

## 相关文档

- Provider 适配边界：见 `src/lib/agent/provider-adapter.ts` 与 `src/lib/agent/adapters/`
- Tool 调用后的审批与执行：见 [Policy Engine](./policy-engine.md)
