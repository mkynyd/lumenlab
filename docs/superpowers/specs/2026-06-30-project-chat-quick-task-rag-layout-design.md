# 项目对话快捷任务 RAG 与布局修复

日期：2026-06-30
状态：已批准，待实现

## 1. 目标

修复 `light-ai-chat` 项目对话中的三个问题：

1. 连续提问时用户消息与 AI 回复重叠、布局错乱。
2. 快捷任务无法正确调用已上传的项目文档，或只调用单个课件。
3. 第一个快捷任务结束后，点击第二个快捷任务时对话区域没有立即刷新。

## 2. 当前问题

### 2.1 布局重叠（问题 1）

`src/lib/hooks/use-chat.ts` 的 `performSend` 在发送新消息前会调用 `abortRef.current?.abort()` 中断上一个流，但**不会**把上一条 assistant placeholder 的 `isStreaming` 置为 `false`。连续提问时，列表中可能同时存在多条 `isStreaming` 的 assistant 消息，导致 `VirtualMessageList` 的预估高度与实际高度不一致，绝对定位的消息发生重叠。

`src/components/chat/virtual-message-list.tsx` 依赖 `estimateMessageHeight` 计算每条消息高度，并在 `estimates` 变化时调用 `virtualizer.measure()`。但新增消息时实际高度与预估高度可能不一致，且没有在新 DOM 稳定后强制重新测量。

### 2.2 快捷任务不走项目资料（问题 2）

`src/lib/agent/skill-router.ts` 的 `needsProjectMaterial` 依赖关键词匹配（如“资料”“文件”“文档”“课件”等）。通用快捷任务（“总结要点”“深入分析”“格式化”）的 prompt 不含这些关键词，导致 `routeSkill` 返回 `profile: "simple"`。

`src/lib/agent/orchestrator.ts` 的 `buildPlannedToolCalls` 只在 `profile !== "simple"` 时调用 `project_rag.search`，因此通用快捷任务完全不会检索项目资料。

当 orchestrator 未启用时（生产环境默认关闭），`src/lib/rag/vector-store.ts` 的 `shouldUseProjectContext` 同样依赖关键词，legacy 路径也会跳过检索。

### 2.3 二次快捷任务不刷新（问题 3）

二次快捷任务发送后，新用户消息已同步加入 `messages`，但 `VirtualMessageList` 没有在新 DOM 稳定后强制重新测量，导致用户看不到新消息。直到 AI 输出第一个 token，触发 `estimates` 变化并调用 `virtualizer.measure()`，布局才恢复正常，但此时又可能回到问题 1 的重叠状态。

## 3. 方案

采用**中等范围的目标性重构**：保留现有虚拟列表架构，修复状态残留和测量时机；给快捷任务加一个显式标识，强制其走项目资料检索。

## 4. 详细设计

### 4.1 布局修复（问题 1、3）

#### 4.1.1 `use-chat.ts` 收尾 stale streaming placeholder

在 `performSend` 追加新 `userMessage` 之前，先把 `prev` 中所有 `isStreaming` 的 assistant 消息强制收尾：

- `isStreaming: false`
- `streamingSource: undefined`
- `streamingStartedAt: undefined`

保证任何时刻只有最新一条 assistant 是 `isStreaming: true`。

#### 4.1.2 `VirtualMessageList` 增强重测量时机

现有逻辑只在 `estimates` 变化时调用 `virtualizer.measure()`。新增一个 `useEffect`，监听 `messages.length` 变化，在 `requestAnimationFrame` 后调用 `virtualizer.measure()`，确保新增消息的实际高度被重新计算。

保持 `getItemKey` 使用 message id，避免 index 变化导致 key 错位。

#### 4.1.3 `MessageBubble` memo 检查

确认 `MessageBubble` 已用 `React.memo` 包裹，避免流式输出时整列表不必要的重渲染。如未包裹，补上。

### 4.2 快捷任务 RAG 修复（问题 2）

#### 4.2.1 请求层增加快捷任务标识

在 `SendMessageInput`（`use-chat.ts`）和 `ChatRequestInput`（`chat-request.ts`）中新增 `isQuickTask?: boolean`。

`QuickTaskBar` 已把 `quickActionId` 传出来，`handleQuickTaskSend` 里把它转成 `isQuickTask: true` 一起发出去。

#### 4.2.2 API 层透传

`route.ts` 解析出 `isQuickTask`，把它传给 `routeSkill` 和 `retrieveProjectContext`（legacy 路径）。

#### 4.2.3 Skill Router 强制快捷任务需要项目资料

在 `skill-router.ts` 的 `inferProfile` 里加一条：

- 如果 `input.isQuickTask && input.projectId`，则 `profile` 至少为 `"rag"`（不再走 simple）。

这样 `buildPlannedToolCalls` 就会进入项目资料分支。

#### 4.2.4 Orchestrator 工具规划保持现有分支

- 有 `selectedFileIds` 时：继续用 `project_files.read` 读取选中文件（最多 5 个，保持现状）。
- 无 `selectedFileIds` 时：用 `project_rag.search` 在项目文件库中检索最相关内容。

这对应“有选中文件时读选中文件，无选中时自动 RAG”。

#### 4.2.5 Legacy 路径兼容

修改 `shouldUseProjectContext` 签名，增加可选参数 `forceProjectContext?: boolean`。

`route.ts` 在 `isQuickTask` 时传 `true`，让 legacy 路径也强制检索项目资料。

## 5. 涉及文件

- `src/lib/hooks/use-chat.ts`
- `src/components/chat/virtual-message-list.tsx`
- `src/components/chat/message-bubble.tsx`（检查 memo）
- `src/lib/chat-request.ts`
- `src/app/api/chat/route.ts`
- `src/lib/agent/skill-router.ts`
- `src/lib/agent/orchestrator.ts`（确认现有分支行为，可能无需改动）
- `src/lib/rag/vector-store.ts`

## 6. 验证计划

使用“网络安全”项目进行测试，该项目已上传文件。

### 6.1 布局问题 1：连续提问

- 在项目对话中快速连续发送 2-3 个问题。
- 观察用户气泡和 AI 气泡是否仍然重叠。
- 检查第一条流式回复未完成时发送第二条，旧 placeholder 是否被正确收尾。

### 6.2 刷新问题 3：二次快捷任务

- 发送一个快捷任务，等 AI 完全回复结束。
- 点击另一个快捷任务。
- 观察新的“快捷任务：xxx”用户消息是否立即出现在对话区域，且布局正常。

### 6.3 RAG 问题 2：快捷任务调用文档

- 不选中任何文件，点击通用快捷任务（如“总结要点”）。
- 确认服务器端触发了 `project_rag.search` 或 `retrieveProjectContext`。
- 选中其中几个文件，再次点击快捷任务，确认走的是 `project_files.read` 读取选中文件。

### 6.4 边界情况

- 文件解析中时点击快捷任务，应继续进入 pending queue。
- 切换对话后重新进入项目，快捷任务仍能正常触发项目资料。
- 普通自由输入（非快捷任务）行为保持不变。

### 6.5 回归检查

- 运行 `npm test` 和 `npm run lint`，确保没有回归。

## 7. 不引入的改动

- 不改文档解析流程。
- 不改模型路由、技能注册表、Auth。
- 不改来源卡片的去重逻辑。
- 不替换虚拟列表为普通滚动。
- 不在 `project_rag.search` 中增加结果多样性限制。
