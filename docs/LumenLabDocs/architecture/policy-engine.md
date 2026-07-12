# Policy Engine

> 面向开发者与自托管维护者，介绍 LumenLab Agent 模式下 Tool 调用的风险分级、审批策略与执行流程。

## 风险等级

`src/lib/agent/types.ts` 定义了五级风险：

| 等级 | 名称 | 默认行为 |
|---|---|---|
| L0 | 无风险 | 自动执行 |
| L1 | 低风险 | 自动执行 |
| L2 | 中风险 | 首次询问（ask_first），后续可记忆为会话级自动 |
| L3 | 高风险 | 每次询问（ask_each） |
| L4 | 阻断级 | 阻断（block） |

风险等级是 Tool 元数据的静态属性，写入 `ToolDefinition.riskLevel`。Skill 与用户偏好**只能收紧**审批策略，不能放宽；L3 / L4 永远强制 `ask_each`，不能被用户偏好永久设为 auto。

## 决策流程

`src/lib/agent/policy-engine.ts` 中的 `evaluatePolicy()` 按以下步骤执行：

1. **Tool 注册检查**：确认 `toolRegistry` 中存在该 Tool。
2. **用户 Scope 检查**：校验用户是否拥有 Tool 与当前 Skill 要求的 scope。
3. **Workspace Policy**：若管理员或配置对某个 Tool / Skill 设置了 `block`，直接拒绝。
4. **Skill Allowlist**：
   - Skill 必须显式允许该 Tool。
   - Tool 风险不能超过 Skill 允许的风险上限。
5. **跨租户所有权检查**：校验参数中引用的 `projectId` 等资源是否属于当前用户。
6. **参数校验**：极简 JSON Schema 校验，确保必填字段存在且类型正确。
7. **审批模式解析**：
   - 起点：Tool 的 `defaultApprovalMode`。
   - 与 Skill 的 `defaultApprovalPolicy` 取更严者。
   - 再与用户偏好 `UserToolPreference.approvalMode` 取更严者；但 L3 / L4 强制回退为 `ask_each`。
8. **会话级预审批**：L0–L2 工具若在本会话已被用户标记为“此会话允许”，则直接放行。
9. **自动放行**：L0–L2 且最终模式为 `auto` 时直接执行。
10. **需要审批**：返回 `require_approval`，并由 `signAndAttachToken()` 签发一次性审批 token。

## 审批 Token

`src/lib/agent/approval-token.ts` 实现一次性审批 token 机制：

- token 格式：`<tokenId>.<raw>`，原始 raw 部分不存储，数据库只保存 sha256 哈希。
- 有效期：5 分钟。
- 参数绑定：签发时计算参数 canonical JSON 的 sha256（`hashArguments`）。
- 消费校验：用户点击“允许”后，`consumeApprovalToken()` 会校验：
  - token 格式是否合法。
  - tokenHash 是否存在且未被消费。
  - 是否过期。
  - 当前请求参数哈希是否与签发时一致（防止模型在等待期间替换参数）。
  - user / conversation / tool / request 是否与待执行记录完全绑定。

## ToolRunner 与执行状态机

`src/lib/agent/tools/tool-runner.ts` 是确定性工具前奏与模型驱动 `AgentLoop` 共用的执行入口。一次调用按固定顺序经过：

1. 解析 Tool / Skill 元数据并调用 Policy Engine。
2. 通过 `ToolExecutionPersistence` 创建 `proposed` 记录，再写审计并发出事件。
3. 拒绝时转为 `blocked`；需审批时签发 token 并转为 `pending_approval`。
4. 自动放行时先转为 `executing`，再调用 handler，最终转为 `succeeded` 或 `failed`。

持久化与审计先于对应 UI 事件完成，避免客户端看到数据库中尚不存在的状态。`src/lib/agent/tool-executor.ts` 仍维护实际 handler 注册表：

- `registerToolHandler(toolId, handler)`：注册工具实现。
- `executeTool(toolId, ctx, args)`：根据 `userId`、`conversationId`、`projectId` 等上下文执行工具。
- Prisma 状态转换由 `src/lib/agent/persistence/prisma-tool-execution-adapter.ts` 统一完成。

工具实现需自行处理：参数归一化、跨租户校验、超时、错误码。

## 事件流与前端渲染

`src/lib/agent/loop/agent-loop.ts` 接收 ProviderAdapter 归一化后的 Tool call，并调用 `ToolRunner` 转换为事件流：

1. 创建 `ToolExecution` 记录，状态为 `proposed`。
2. 调用 Policy Engine 决策。
3. 若被策略拒绝，落库为 `blocked` 并发出 `tool_blocked`。
4. 若需要审批，签发 token，发出 `approval_required` 事件，前端 `AgentTimeline` 渲染审批卡片。
5. 若自动放行，发出 `tool_started` → `tool_progress`（可选）→ `tool_completed` / `tool_failed`。

事件通过 SSE 以 `event: agent` 的形式注入主聊天流，前端解析后展示在消息旁边的 Timeline 中。

## 批准、拒绝与暂停边界

`POST /api/agent/approve` 不再只修改审批状态。服务端会先检查 `ToolExecution` 的用户归属与 `pending_approval` 状态，再用数据库中保存的规范化参数消费 token，校验 user / conversation / tool / request 绑定；随后原子抢占执行、调用同一 Tool handler，并把记录落为 `succeeded` 或 `failed`。L3 / L4 不允许会话级批准。前端把该返回值映射为 `tool_completed` 或 `tool_failed` 终态。

`POST /api/agent/reject` 也通过带 `pending_approval` 条件的原子更新抢占记录，再将其落为 `rejected`，因此不会覆盖一个并发批准后已经进入 `executing` 的执行。前端显示拒绝终态。批准或拒绝都**不会自动恢复**原请求中已暂停的 Provider continuation；用户需要发送下一条消息继续对话。这样避免在缺少可持久化 Provider continuation token 的情况下伪造工具结果或重复模型调用。

## 典型 Tool 风险分配

| Tool | 风险 | 默认模式 | 说明 |
|---|---|---|---|
| `project_files.list` | L1 | auto | 只读列表 |
| `project_files.read` | L1 | auto | 只读文件内容 |
| `artifact.save` | L2 | ask_first | 写入成果 |
| `artifact.export_docx` | L3 | ask_each | 生成并下载文档 |
| `project_files.delete` | L3 | ask_each | 删除资料 |
| `web_search_20250305` | L1 | auto | 外部搜索，只读 |

> 实际风险值以 `src/lib/tools/registry.ts` 与 `src/lib/skills/registry.ts` 中的定义为准。

## 审计

`src/lib/agent/audit-log.ts` 在工具提出、审批、执行、失败等节点写入 `AgentAuditLog`，便于后续排查与合规审计。
