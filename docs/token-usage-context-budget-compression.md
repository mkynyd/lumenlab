# Token 用量统计 / 上下文窗口预算 / 上下文压缩 设计方案

> 状态：已实现
> 背景：为公测结束后的订阅制收费做数据准备，同时解决长对话可能超出模型上下文上限的问题。

---

## 目标

1. 建立可追溯、可分析的 Token 用量体系，为后续 Free / Pro / Premium 三档定价提供数据依据。
2. 在服务端为每次对话请求估算上下文占用，防止请求直接撞上模型 1M 上下文上限。
3. 当上下文接近上限时，自动对早期对话做滚动摘要，保留关键约束和近期原文。

---

## 范围

本次设计覆盖：

- `light-ai-chat` 主业务应用
- 两个主聊天模型：DeepSeek V4（Pro / Flash）和 MiniMax M3
- 一次完整的 `/api/chat` 请求生命周期：预算检查 → 压缩 → 模型调用 → 用量记录

不覆盖：

- 支付网关、订阅购买流程（A 测期间不收费）
- 管理端额度管理（后续可接入，本次只留脚本级能力）
- 非聊天场景的 Token 用量（如 RAG 索引、MinerU 解析、文件增强等后台任务可后续扩展）

---

## 关键决策

| 决策点 | 结论 |
|--------|------|
| 计费维度 | 按用户个人维度记录和限额 |
| 计费单位 | 统一信用点，不同模型 / token 类型按成本权重折算 |
| Token 计数 | 本地 tokenizer 估算用于预算检查；API 返回的 usage 用于精确记账 |
| 用量限制（A 测） | 不限制上限，所有 A 测用户默认 Premium，仅记录用量 |
| 用量周期 | 按用户注册日起 30 天滚动窗口；同时支持每日 / 每周 / 每 5 小时聚合分析 |
| 上下文预算 | 模型 1M 上下文预留 64K 输出空间，预算上限约 936K |
| 预算阈值 | 70% 时前端警告，90% 时服务端自动压缩 |
| 压缩模型 | DeepSeek V4 Flash（成本低、速度快、上下文长） |
| 压缩策略 | 滚动摘要超出保护窗口的最早若干轮对话 |
| 受保护内容 | 系统提示、最近 6 - 10 轮对话、RAG 注入的上下文 |
| 摘要持久化 | 作为 `role=system` 的摘要消息存入 `Message` 表，后续请求自动引用 |
| 手动压缩 | 支持用户输入 `/compact [可选提示词]`，留空则使用默认摘要指令 |

---

## 数据模型变更

### User 模型扩展

```prisma
model User {
  // ... 现有字段 ...

  planTier        String   @default("premium") // free | pro | premium
  planCredits     Int      @default(0)         // 当前周期总信用点额度
  creditsUsed     Int      @default(0)         // 当前周期已用信用点
  cycleStartedAt  DateTime @default(now())     // 当前 30 天周期开始时间
}
```

A 测期间 `planTier` 默认 `premium`，`planCredits` 可设为一个极大值（如 `Integer.MAX_VALUE` 或 0 表示不限），`creditsUsed` 只增不减、不拦截请求。

### TokenUsage 模型（新增）

```prisma
model TokenUsage {
  id                    String   @id @default(cuid())
  userId                String
  conversationId        String?
  messageId             String?  // 关联本次 assistant 回复
  model                 String   // 实际请求的模型 ID
  provider              String   // deepseek / minimax
  inputCacheHitTokens   Int      @default(0)
  inputCacheMissTokens  Int      @default(0)
  outputTokens          Int      @default(0)
  totalTokens           Int      @default(0)
  creditsConsumed       Int      @default(0) // 按信用点权重折算后的消耗
  createdAt             DateTime @default(now())

  user         User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  conversation Conversation? @relation(fields: [conversationId], references: [id], onDelete: SetNull)
  message      Message?      @relation(fields: [messageId], references: [id], onDelete: SetNull)

  @@index([userId])
  @@index([userId, createdAt])
  @@index([conversationId])
}
```

### Message 模型扩展

```prisma
model Message {
  // ... 现有字段 ...

  subtype String? // "context-summary" 等，普通消息为 null
  metadata Json?  // 摘要时可记录被压缩的消息范围、用户自定义提示词等
}
```

`subtype = "context-summary"` 表示这条 system 消息是由压缩生成的摘要，便于前端展示“上下文已压缩”提示。

---

## 信用点换算

以 **DeepSeek V4 Flash 输入 token（缓存未命中）** 为基准：

> 1 信用点 = 1000 个 Flash 输入 token

其他 token 类型的权重：

| 模型 | token 类型 | 每 1K tokens 信用点 |
|------|-----------|-------------------|
| DeepSeek V4 Flash | 输入 cache hit | 0.02 |
| DeepSeek V4 Flash | 输入 cache miss | 1.0 |
| DeepSeek V4 Flash | 输出 | 2.0 |
| DeepSeek V4 Pro | 输入 cache hit | 0.025 |
| DeepSeek V4 Pro | 输入 cache miss | 3.0 |
| DeepSeek V4 Pro | 输出 | 6.0 |
| MiniMax M3 | 输入 | 2.1 |
| MiniMax M3 | 输出 | 8.4 |
| MiniMax M3 | 缓存读取 | 0.42 |

说明：

- 权重来自 `docs/DeepSeek/deepseek-models-pricing.md` 和 `docs/MiniMax/minimax-pricing.md` 的人民币价格比例。
- 输入 / 输出 / 缓存命中分项记录，便于后续精确成本核算。
- 后续上线订阅时，Free / Pro / Premium 三档的额度可以用同一套信用点体系表达。

---

## Token 计数策略

### 1. 上下文预算检查（本地估算）

使用 `tiktoken` 的 `cl100k_base` 编码进行快速估算：

```ts
import { encoding_for_model } from "tiktoken";

const enc = encoding_for_model("gpt-4o"); // 使用 cl100k_base
function estimateTokens(messages: Array<{ role: string; content: string }>) {
  return messages.reduce((sum, m) => {
    // 每条消息额外加上角色和格式开销，约 4 tokens
    return sum + 4 + enc.encode(m.content).length;
  }, 2); // priming offset
}
```

估算范围：

- 系统提示（含项目 system prompt、全局指令）
- 当前对话历史
- RAG 检索注入的上下文
- 用户最新输入
- 图片 / 视频附件的占位 token（按每张 256 tokens 保守估算）

由于 DeepSeek 和 MiniMax 的 Anthropic 兼容接口与 OpenAI tokenizer 并不完全一致，本地估算只用于预算检查，不用于最终扣费。

### 2. 精确记账（API usage）

模型返回的 SSE 流结束时，从 `usage` 对象读取：

- `input_cache_hit_tokens`
- `input_cache_miss_tokens`
- `output_tokens`
- `total_tokens`

按信用点权重计算 `creditsConsumed`，写入 `TokenUsage`，并累加到 `User.creditsUsed`。

---

## 用量统计与周期

### 滚动窗口

- 每个用户的统计周期起点为 `User.createdAt`。
- 每 30 天为一个周期，`cycleStartedAt` 记录当前周期开始时间。
- 跨周期时重置 `creditsUsed` 并更新 `cycleStartedAt`。

### 聚合查询

基于原始 `TokenUsage` 记录，按需聚合：

```sql
-- 当前周期总用量
SELECT SUM("creditsConsumed") FROM "TokenUsage"
WHERE "userId" = $1 AND "createdAt" >= $2;

-- 每日用量
SELECT DATE("createdAt"), SUM("creditsConsumed")
FROM "TokenUsage"
WHERE "userId" = $1
GROUP BY DATE("createdAt");

-- 最近 5 小时用量
SELECT SUM("creditsConsumed") FROM "TokenUsage"
WHERE "userId" = $1 AND "createdAt" >= now() - interval '5 hours';
```

A 测期间可先用 Prisma 查询或脚本生成统计报告，不需要定时物化任务。

---

## 上下文窗口预算

### 预算上限

```ts
const MODEL_CONTEXT_LIMIT = 1_000_000; // DeepSeek V4 / MiniMax M3
const OUTPUT_RESERVE = 64_000;
const CONTEXT_BUDGET = MODEL_CONTEXT_LIMIT - OUTPUT_RESERVE; // 936_000

const WARN_THRESHOLD = 0.7;     // 655K tokens
const COMPRESS_THRESHOLD = 0.9; // 842K tokens
```

### 检查流程

在 `/api/chat/route.ts` 组装最终 `messages` 数组前：

1. 用本地 tokenizer 估算 `messages` 的总 token 数。
2. 若超过 `WARN_THRESHOLD`：在 SSE 流首帧返回 `warning` 事件，前端显示“上下文接近上限”。
3. 若超过 `COMPRESS_THRESHOLD`：触发自动压缩，重跑步骤 1，直到低于阈值或无法继续压缩。
4. 若压缩后仍超过 `CONTEXT_BUDGET`：返回 400 错误，提示用户新建对话或缩短输入。

---

## 上下文压缩

### 压缩对象

从对话历史中筛选出可被摘要的部分：

```ts
const protectedWindow = 6; // 保留最近 6 轮 user/assistant
const compressible = history.slice(0, -protectedWindow * 2);
```

始终保护：

- 所有 `role=system` 消息（含项目 system prompt、RAG 注入）
- 最近 `protectedWindow` 轮 user/assistant 原文
- 用户明确标记为重要的消息（后续扩展）

### 摘要生成

调用 DeepSeek V4 Flash：

```ts
const summary = await completeChat({
  model: "deepseek-v4-flash",
  messages: [
    { role: "system", content: buildSummaryPrompt(userPrompt) },
    { role: "user", content: formatHistoryForSummary(compressible) },
  ],
  max_tokens: 2000,
});
```

默认摘要提示词：

> 请把以下对话历史压缩成一份摘要。保留关键事实、用户偏好、约束条件和未完成事项；丢弃寒暄和重复内容。用中文输出。

如果用户输入了 `/compact 重点保留 API 设计相关约定`，则把该提示词追加到默认提示词中。

### 摘要持久化

将摘要作为一条新的 `Message` 插入：

```ts
await prisma.message.create({
  data: {
    conversationId: conversation.id,
    role: "system",
    content: `【此前对话压缩上下文】\n${summary}`,
    subtype: "context-summary",
    metadata: {
      compressedRange: { startIndex, endIndex },
      userPrompt: userPrompt || null,
      model: "deepseek-v4-flash",
    },
  },
});
```

后续请求加载历史时，这条 system 摘要会被自动包含。

### 手动压缩

用户输入以 `/compact` 开头的消息时：

1. 前端不把它作为 user 消息发送给模型。
2. 调用专用的压缩接口 `/api/chat/compact`。
3. 服务端对所有可压缩历史生成摘要并持久化。
4. 返回成功事件，前端刷新消息列表。

---

## A 测阶段行为

- 所有 A 测用户 `planTier = premium`，`planCredits` 设为 `0` 或极大值，代码中视为“不限制”。
- 聊天请求不检查剩余额度，只记录 `TokenUsage`。
- 上下文预算和自动压缩仍然启用，防止因上下文超限导致 API 失败。
- 提供一个管理脚本或临时 API，用于导出指定用户的：总用量、日均、最大值、中位数、模型分布、信用点消耗。

---

## 接口与前端变化

### 后端

- `/api/chat/route.ts`：增加预算检查、压缩触发、用量写入。
- `/api/chat/compact`（新增）：手动压缩接口。
- `/api/me/usage`（新增）：返回当前周期用量、各模型占比、近 7 天趋势。
- 管理脚本：`scripts/analyze-usage.ts`（新增）用于批量统计。

### 前端

- 聊天界面顶部增加“已用上下文 / 预算”进度条。
- 接近 70% 时显示橙色警告；服务端返回 `warning` 事件时同步提示。
- 自动压缩后，在摘要消息旁显示“上下文已压缩”徽章。
- 设置或个人中心增加“本月用量”看板。

---

## 实现步骤

1. 安装依赖：`npm install tiktoken`。
2. Prisma schema 变更：扩展 `User`，新增 `TokenUsage`，扩展 `Message`。
3. 生成并执行迁移：`npx prisma migrate dev`。
4. 新增 `src/lib/tokens/`：
   - `tokenizer.ts`：本地 token 估算。
   - `credits.ts`：信用点换算。
   - `budget.ts`：上下文预算检查。
5. 新增 `src/lib/chat/compression.ts`：滚动摘要逻辑。
6. 修改 `src/app/api/chat/route.ts`：
   - 请求前预算检查与压缩。
   - 请求完成后写入 `TokenUsage` 并更新 `User.creditsUsed`。
7. 新增 `/api/chat/compact` 路由和 `/api/me/usage` 路由。
8. 新增前端用量组件和上下文警告 UI。
9. 新增测试：tokenizer、budget、compression、credits、route 集成测试。
10. 运行 `npm run lint`、`npm test`、`npm run build` 验证。

---

## 风险与后续问题

- **Tokenizer 估算误差**：DeepSeek / MiniMax 的真实 tokenizer 与 `cl100k_base` 不完全一致。预算检查应保守，预留足够余量。
- **图片 / 视频 token 估算**：本地无法精确计算多模态 token，暂时使用固定占位值，后续可接入 provider 的 token-count API。
- **摘要质量**：压缩后可能丢失细节，需要 A 测期间观察用户反馈，必要时允许用户调整保护窗口大小。
- **信用点定价**：A 测结束后，根据实际成本分布重新校准 Free / Pro / Premium 的额度数值。

---

## 参考文档

- `docs/DeepSeek/deepseek-models-pricing.md`
- `docs/MiniMax/minimax-pricing.md`
- `docs/MiniMax/minimax-models-intro.md`
- `prisma/schema.prisma`
- `src/app/api/chat/route.ts`
