# MiniMax 多模态 + DeepSeek 协作：面向大学生 CS 课程的 AI 学习平台

> 产品方向：AI 实验工作台 + AI 资料整理与复习系统 + 普通 Chat
>
> 技术路径：DeepSeek 无识图能力 → MiniMax M3 承担视觉理解 → DeepSeek 承担教学推理与内容生成
>
> 目标用户：大学计算机/软件工程相关专业学生
>
> **统一 SDK**：MiniMax 和 DeepSeek 均使用 Anthropic SDK（`@anthropic-ai/sdk`）调用，共享同一套消息格式、流式事件、工具调用范式。

---

## 〇、为什么统一用 Anthropic SDK + 双层缓存策略

### 统一 Anthropic SDK 的收益

| 维度 | 收益 |
|------|------|
| **依赖简化** | 只需 `@anthropic-ai/sdk` 一个包，减少 bundle 体积 |
| **消息格式统一** | 两边的 messages/content blocks/thinking/tool_use 结构完全一致 |
| **流式处理统一** | 同一套 SSE 事件模型（`content_block_delta` 等），前端只需一套流式解析 |
| **工具调用统一** | tool_use / tool_result 格式一致，多轮传递不用转换 |
| **代码复用** | `createMessage()` 工厂函数，只需换 `baseURL` + `apiKey` + `model` |

### 双层自动缓存 —— 无需显式 `cache_control` 就能命中

```
┌─────────────────────────────────────────────────────────┐
│                   缓存策略对比                           │
├─────────────────────────┬───────────────────────────────┤
│     MiniMax M3          │       DeepSeek                │
├─────────────────────────┼───────────────────────────────┤
│ 自动缓存：≥512 tokens   │ KV Cache：自动前缀匹配落盘    │
│ 前缀自动识别 + 命中     │ 硬盘级缓存，秒级构建           │
│ 缓存命中 token ¥0.42/M  │ 命中后显著降低延迟和成本       │
│                         │                               │
│ 可选：Anthropic 主动缓存│ cache_control 被忽略           │
│ cache_control 显式标记  │ 但 KV Cache 自动完成同样的事    │
└─────────────────────────┴───────────────────────────────┘
```

**关键洞察**：在我们的场景中，两种缓存机制天然互补：

- **资料复习模式**：学生上传同一课程的课件 → MiniMax 提取 prompt（固定格式）自动缓存 → DeepSeek 知识增强的 system prompt 在多次调用中被 KV Cache 自动落盘
- **实验工作台模式**：DeepSeek 导师 system prompt（~2000 tokens）在每次实验会话中重复出现 → KV Cache 自动命中
- **多轮对话**：整个对话历史的公共前缀被两个系统自动缓存，无需手动管理

**不需要**在 DeepSeek 侧显式设置 `cache_control`（DeepSeek 会忽略它），也不需要在 MiniMax 侧显式设置（除非你想精确控制缓存断点）。两个系统的自动缓存机制已经处理了绝大多数场景。

### 缓存叠加深度分析：三种场景走一遍

两种缓存机制是否可以叠加？答案是：**可以叠加，但不是"串联叠加"，而是在三条独立的缓存线上各自命中。MiniMax 缓存的是自己的 system prompt + 图片数据，DeepSeek 缓存的是自己的 system prompt + 对话历史。两者在不同层工作，各管各的，缺一层不影响其他层。**

```
┌─────────────────────────────────────────────────────────────────┐
│                    三层缓存叠加架构                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   【Layer 1】MiniMax 自动缓存 — 视觉提取层                        │
│   ┌───────────────────────────────────────────────────────┐     │
│   │  system: "你是一个教材内容数字化工具..."  ← 固定文本    │     │
│   │  messages: [{ image: 教材页照片 }]          ← 变化内容 │     │
│   │                                                       │     │
│   │  缓存行为：system 前缀命中 ✅                           │     │
│   │  命中收益：~3000 tokens 的提取 prompt 不重复计费         │     │
│   │  缓存机制：前缀 hash 匹配，≥512 tokens 自动触发          │     │
│   └───────────────────────────────────────────────────────┘     │
│                           │                                     │
│                           ▼                                     │
│   【Layer 2】DeepSeek KV Cache — system prompt 层                │
│   ┌───────────────────────────────────────────────────────┐     │
│   │  system: "你是一个大学课程的实验导师..." ← 固定文本     │     │
│   │  messages: [                                          │     │
│   │    { user: "解释这段代码" + MiniMax 提取结果 } ← 变动  │     │
│   │  ]                                                    │     │
│   │                                                       │     │
│   │  缓存行为：system 前缀命中 ✅                           │     │
│   │  命中收益：~2000 tokens 导师 prompt 不重复推理           │     │
│   │  缓存机制：硬盘级前缀匹配，公共前缀自动检测落盘           │     │
│   └───────────────────────────────────────────────────────┘     │
│                           │                                     │
│                           ▼                                     │
│   【Layer 3】DeepSeek KV Cache — 多轮对话历史层                   │
│   ┌───────────────────────────────────────────────────────┐     │
│   │  messages: [                                          │     │
│   │    轮1: { user: Q1, assistant: A1 }  ← 已落盘缓存      │     │
│   │    轮2: { user: Q2, assistant: A2 }  ← 已落盘缓存      │     │
│   │    轮3: { user: Q3 }                  ← 当前请求        │     │
│   │  ]                                                    │     │
│   │                                                       │     │
│   │  缓存行为：轮1+轮2 前缀命中 ✅                          │     │
│   │  命中收益：历史对话不重复推理，延迟降低 50-80%           │     │
│   └───────────────────────────────────────────────────────┘     │
│                                                                 │
│   叠加效果 = Layer1 命中 + Layer2 命中 + Layer3 命中             │
│            = 三层独立缓存，各自基于文本前缀 hash 匹配              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**关键结论：Layer 1 命中与否不影响 Layer 2/3 能否命中。它们分别缓存不同 URL 端点、不同请求体中的固定前缀，彼此完全独立。**

---

### 场景 A：同一课程连续上传 3 张不同教材页（资料复习模式）

```
┌──────────────┬────────────────┬────────────────┬────────────────┐
│              │  第 1 张 (创建)  │  第 2 张 (部分命中)│  第 3 张 (部分命中)│
├──────────────┼────────────────┼────────────────┼────────────────┤
│ MiniMax      │ system: 创建    │ system: 命中 ✅  │ system: 命中 ✅  │
│ Layer 1      │ image: 创建     │ image: ❌ (不同) │ image: ❌ (不同)│
├──────────────┼────────────────┼────────────────┼────────────────┤
│ DeepSeek     │ system: 创建    │ system: 命中 ✅  │ system: 命中 ✅  │
│ Layer 2      │ msg:  创建      │ msg:  ❌ (不同)  │ msg:  ❌ (不同)  │
├──────────────┼────────────────┼────────────────┼────────────────┤
│ DeepSeek     │ 无历史          │ 无历史          │ 无历史          │
│ Layer 3      │                │                │                │
├──────────────┼────────────────┼────────────────┼────────────────┤
│ 每张叠加收益  │ —              │ ~5000 tokens   │ ~5000 tokens    │
│              │                │ 两个 system 不  │ 两个 system 不  │
│              │                │ 重复计费/推理    │ 重复计费/推理    │
└──────────────┴────────────────┴────────────────┴────────────────┘

收益分析：
- 可缓存（固定部分）：MiniMax system + DeepSeek system = ~5000 tokens/次
- 不可缓存（变动部分）：图片数据 + 提取结果 + 最终回复 = ~4000 tokens/次
- 缓存命中率趋势：第1张 0% → 第2张 ~55% → 第3张 ~55%（稳定）
```

---

### 场景 B：同一张截图反复追问（实验工作台模式）—— 叠加效果最显著

```
学生发了 IDE 报错截图，然后追问了 4 个相关问题：

轮1: [报错截图] + "这个 NullPointerException 是什么意思？"
  所有层 → 创建缓存

轮2: [同一张截图] + "第 42 行的 worker.run() 为什么会是 null？"
  MiniMax Layer1:  system ✅ + image ✅  → 截图完全相同，图片数据全命中
  DeepSeek Layer2: system ✅            → 导师 prompt 命中
  DeepSeek Layer3: 轮1 ✅              → 对话历史命中
  → 三层全部命中 ✅✅✅  几乎只计费最新的 user message

轮3: [同一张截图] + "如果我加个 if 判断，应该写在哪？"
  MiniMax Layer1:  system ✅ + image ✅
  DeepSeek Layer2: system ✅
  DeepSeek Layer3: 轮1 ✅ + 轮2 ✅
  → 三层全部命中 ✅✅✅

轮4: [同一张截图] + "那这段代码还有别的潜在 bug 吗？"
  MiniMax Layer1:  system ✅ + image ✅
  DeepSeek Layer2: system ✅
  DeepSeek Layer3: 轮1 ✅ + 轮2 ✅ + 轮3 ✅
  → 三层全部命中 ✅✅✅

┌──────────────┬─────────┬─────────┬─────────┬─────────┐
│              │  轮 1   │  轮 2   │  轮 3   │  轮 4   │
├──────────────┼─────────┼─────────┼─────────┼─────────┤
│ MM 图片缓存   │  创建   │  命中   │  命中   │  命中   │
│ MM system   │  创建   │  命中   │  命中   │  命中   │
│ DS system   │  创建   │  命中   │  命中   │  命中   │
│ DS 历史缓存   │  —     │ 轮1命中  │ 轮1-2   │ 轮1-3   │
├──────────────┼─────────┼─────────┼─────────┼─────────┤
│ 缓存命中率    │   0%    │  ~85%   │  ~90%   │  ~92%   │
│ 延迟（相对轮1）│  基准   │ -60%    │ -65%    │ -70%    │
└──────────────┴─────────┴─────────┴─────────┴─────────┘
```

**这是叠加效果最明显的场景**：同一张图反复追问时，MiniMax 缓存了图片 token（最大头），DeepSeek 逐轮缓存了不断增长的对话历史。越追问越省钱、越追问越快。

---

### 场景 C：资料复习模式 — RAG 检索后的生成（日常高频场景）

```
学生A 上传数据结构第1-5章课件（已完成提取+存储），开始期末复习：

请求1: "出数据结构第1-2章的复习提纲"
  DeepSeek system: "复习生成prompt" + RAG检索到的第1-2章知识点 → 创建缓存
  Layer3: 无历史

请求2: "再出一份模拟卷"
  DeepSeek system:  "复习生成prompt"（命中 ✅） + RAG检索结果（变化 ❌）
  DeepSeek Layer3: 请求1历史（命中 ✅）
  → 两层部分命中

请求3: "把第3章的知识点也总结一下"
  DeepSeek system: "复习生成prompt"（命中 ✅） + RAG检索结果（变化 ❌）
  DeepSeek Layer3: 请求1 ✅ + 请求2 ✅
  → 两层部分命中

┌──────────────────────────────────────────────────────────────┐
│            RAG 场景的缓存优化技巧                              │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ❌ 低效做法（system 每次都变 → 缓存全 miss）：                 │
│     system: "固定导师角色" + "检索到的知识点: {RAG结果}"       │
│     → system 整体 hash 变了 → Layer2 全 miss                  │
│                                                              │
│  ✅ 高效做法（system 完全固定 → 缓存必命中）：                   │
│     system: "固定导师角色"   ← 永远不变，100% 缓存命中          │
│     messages: [                                             │
│       { user: "参考资料:\n{RAG结果}\n\n问题:\n{学生提问}" }     │
│     ]                                                       │
│     → 只有 user message 是新的，system 缓存长期有效            │
│                                                              │
│  收益：~2000 tokens 的 system prompt 永久缓存，               │
│        不管 RAG 检索到什么内容都不会破坏                        │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

### 缓存收益量化总结

```
┌──────────────────────────────────────────────────────────────────┐
│                    实际瓶颈分析                                    │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  缓存能覆盖的部分（固定文本，每次请求结构不变）:                      │
│  ✅ MiniMax 提取 prompt      ~3000 tokens  → 节省 ~¥0.006/次      │
│  ✅ DeepSeek system prompt   ~2000 tokens  → 节省 ~¥0.004/次      │
│  ✅ 多轮对话历史              ~4000 tokens  → 节省 ~¥0.008/轮      │
│                                                                  │
│  缓存覆盖不了的部分（每次请求内容必然不同）:                          │
│  ❌ 图片数据本身              ~2000 tokens  → ¥0.004/次（不可避免） │
│  ❌ MiniMax 提取结果          ~800 tokens   → ¥0.0016/次（不可避免）│
│  ❌ DeepSeek 最终回复         ~1500 tokens  → ¥0.003/次（不可避免） │
│                                                                  │
│  结论：不可缓存的部分占约 60%，但它们确实是每次不同的信息，           │
│        这不是架构缺陷，是信息论的必然。                              │
│        三层自动缓存在不增加任何代码复杂度的情况下，                    │
│        自动覆盖了可优化的 40%。                                     │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 最大化缓存命中率的架构原则

| 原则 | ✅ DO | ❌ DON'T |
|------|-------|----------|
| **System prompt 集中管理** | 4 套固定模板（通用Chat/实验导师/知识整理/复习生成），版本号管理 | 每处调用都内联一段略微不同的 system text |
| **变动内容放末尾** | RAG 检索结果放 user message 末尾 | RAG 结果拼到 system prompt（破坏缓存） |
| **批量更新** | system prompt 改动用版本号，一次性批量替换 | 零碎修改（改一个词就全量失效） |
| **同一课程复用** | 同一门课的所有学生 share 同一套 system prompt | 每个学生/每节课生成变体 system |
| **监控命中率** | 通过 `extractCacheUsage()` 定期输出 Layer1/2/3 命中率 | 上线后从不检查缓存表现 |
| **图片复用感知** | 同一张图片的多次追问保持 image URL 不变 | 每次重新上传/重新编码同一张图 |

---

## 一、产品模式总览

本平台包含三种协作模式，共用同一套 Anthropic SDK + 双层路由：

```
                          ┌─────────────────────────┐
                          │       用户输入            │
                          │  文本 + 可选图片/文件      │
                          └────────────┬────────────┘
                                       │
                                       ▼
                          ┌─────────────────────────┐
                          │     输入分析 & 路由       │
                          │  文本意图 + 附件类型判定   │
                          └────────────┬────────────┘
                                       │
               ┌───────────────────────┼───────────────────────┐
               │                       │                       │
               ▼                       ▼                       ▼
    ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
    │  模式一：普通Chat │    │ 模式二：实验工作台 │    │ 模式三：资料复习   │
    │  闲聊/问答/编程   │    │ 写代码/调试/实验   │    │ 整理课件/生成考题  │
    └────────┬────────┘    └────────┬────────┘    └────────┬────────┘
             │                      │                      │
             ▼                      ▼                      ▼
     纯文本 → DeepSeek      图片/截图 → MiniMax      图片/文档 → MiniMax
     图片提问 → MM→DS       提取代码/错误/图表        OCR 提取知识点
                                  │                      │
                                  ▼                      ▼
                             DeepSeek 推理          DeepSeek 结构化整理
                             分析/讲解/指导          总结/出题/生成脑图

           ╔═══════════════════════════════════════════════════╗
           ║        统一底层：Anthropic SDK                     ║
           ║  MiniMax:  baseURL = api.minimaxi.com/anthropic    ║
           ║  DeepSeek: baseURL = api.deepseek.com/anthropic    ║
           ║  缓存: 双方自动前缀缓存，零配置命中                  ║
           ╚═══════════════════════════════════════════════════╝
```

### 三种模式的 MiniMax — DeepSeek 分工

| 模式 | MiniMax M3 职责 | DeepSeek 职责 |
|------|----------------|--------------|
| **普通 Chat** | 理解用户发的图片内容（报错截图、表情包、生活照等） | 日常对话、编程答疑、计算机通识解答 |
| **实验工作台** | 识别代码截图、IDE 界面、电路图/流程图、手写伪代码、实验器材照片 | 代码调试诊断、算法讲解、实验原理分析、报告框架生成、分步指导 |
| **资料整理与复习** | OCR 教材/PPT/板书/手写笔记、提取图表数据、识别公式 | 知识点归纳、重点标注、生成复习提纲、出模拟题、制作思维导图结构 |

---

## 二、统一 SDK 调用封装

### 类型定义

```typescript
// lib/ai-client.ts

import Anthropic from '@anthropic-ai/sdk';

// ---------- 两个客户端实例 ----------

const minimaxClient = new Anthropic({
  baseURL: 'https://api.minimaxi.com/anthropic',
  apiKey: process.env.MINIMAX_API_KEY!,
});

const deepseekClient = new Anthropic({
  baseURL: 'https://api.deepseek.com/anthropic',
  apiKey: process.env.DEEPSEEK_API_KEY!,
});

// ---------- 模型名映射 ----------

/** 在 DeepSeek Anthropic 端点中使用的模型名 */
type DeepSeekModel = 'claude-opus-4-8' | 'claude-sonnet-4-6' | 'claude-haiku-4-5';
// claude-opus-4-8  → deepseek-v4-pro
// claude-sonnet-4-6 → deepseek-v4-flash
// claude-haiku-4-5 → deepseek-v4-flash

type MiniMaxModel = 'MiniMax-M3' | 'MiniMax-M2.7' | 'MiniMax-M2.7-highspeed';

// ---------- 统一调用工厂 ----------

interface UnifiedCallOptions {
  provider: 'minimax' | 'deepseek';
  model?: string;
  system?: string;
  messages: Anthropic.MessageParam[];
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
  /** MiniMax 专用：显式缓存控制（可选，自动缓存通常已够用） */
  cacheControl?: boolean;
}

async function createMessage(opts: UnifiedCallOptions) {
  const client = opts.provider === 'minimax' ? minimaxClient : deepseekClient;
  const defaultModel = opts.provider === 'minimax'
    ? 'MiniMax-M3'
    : 'claude-sonnet-4-6'; // → deepseek-v4-flash

  // MiniMax 侧：如果启用显式缓存，在 system 末尾加 cache_control
  // DeepSeek 侧：忽略 cache_control，依赖自带 KV Cache
  const system = opts.cacheControl && opts.provider === 'minimax'
    ? [
        { type: 'text' as const, text: opts.system || '' },
        { type: 'text' as const, text: '', cache_control: { type: 'ephemeral' as const } },
      ]
    : opts.system;

  return client.messages.create({
    model: opts.model || defaultModel,
    max_tokens: opts.max_tokens || 4096,
    temperature: opts.temperature ?? 0.7,
    system: system as any,
    messages: opts.messages,
    stream: opts.stream ?? false,
  });
}

// ---------- 缓存感知的 usage 提取 ----------

interface CacheUsage {
  inputTokens: number;
  outputTokens: number;
  cacheHitTokens: number;    // 来自 MiniMax 的 cache_read_input_tokens
  cacheMissTokens: number;   // 来自 DeepSeek 的 prompt_cache_miss_tokens
  cacheHitRate: number;      // 命中率
}

function extractCacheUsage(usage: any, provider: 'minimax' | 'deepseek'): CacheUsage {
  if (provider === 'minimax') {
    return {
      inputTokens: usage.input_tokens || 0,
      outputTokens: usage.output_tokens || 0,
      cacheHitTokens: usage.cache_read_input_tokens || 0,
      cacheMissTokens: usage.cache_creation_input_tokens || 0,
      cacheHitRate: usage.input_tokens > 0
        ? (usage.cache_read_input_tokens || 0) / (usage.input_tokens + (usage.cache_read_input_tokens || 0))
        : 0,
    };
  }
  // DeepSeek KV Cache
  return {
    inputTokens: usage.input_tokens || 0,
    outputTokens: usage.output_tokens || 0,
    cacheHitTokens: usage.prompt_cache_hit_tokens || 0,
    cacheMissTokens: usage.prompt_cache_miss_tokens || 0,
    cacheHitRate: (usage.prompt_cache_hit_tokens + (usage.prompt_cache_miss_tokens || 0)) > 0
      ? usage.prompt_cache_hit_tokens / (usage.prompt_cache_hit_tokens + usage.prompt_cache_miss_tokens)
      : 0,
  };
}
```

### 缓存最佳实践

```
┌─────────────────────────────────────────────────────────────────┐
│              如何让两种缓存都最大化命中                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. 固定内容在前，变动内容在后                                     │
│     system: "[固定的导师角色描述]\n[固定的输出格式要求]"             │
│     messages: [历史消息（固定）, 最新用户问题（变动）]               │
│                                                                 │
│  2. system prompt 版本化管理                                     │
│     不要每次改 system prompt 的一个词 → 整个缓存失效               │
│     用版本号管理，批量更新                                        │
│                                                                 │
│  3. 长上下文资料放 system（最容易被缓存）                           │
│     复习模式的课程知识库注入 system，而非拼到 user message 末尾      │
│                                                                 │
│  4. 监控缓存命中率                                                │
│     通过 extractCacheUsage() 定期打印命中率                       │
│     资料复习模式目标：>80%；实验模式目标：>60%                      │
│                                                                 │
│  5. MiniMax 可选：显式 cache_control 用于超大                      │
│     教材页提取 prompt（~3000 tokens），标记在末尾：                  │
│     cacheControl: true → 第二次起自动命中                         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 三、普通 Chat 模式

### 路由规则

- 纯文本输入 → DeepSeek 直通（零额外开销，DeepSeek KV Cache 自动缓存 system prompt）
- 含图片输入 → MiniMax M3 提取描述 → DeepSeek 基于描述回答

### MiniMax 视觉提取 Prompt

```
你是一个视觉信息提取器。请客观描述你在这张图片中看到的内容。

包括：
- 这张图片展示了什么（场景/物体/人物/界面）
- 图中出现的所有文字（逐字转录）
- 值得注意的细节

只描述，不解读，不推理。
```

### DeepSeek 系统 Prompt

```
你是一个面向大学生的 AI 学习助手。你可以回答计算机相关的各类问题，
也能基于用户提供的图片描述帮助理解视觉内容。

风格要求：
- 对 CS 专业术语给出简短解释（用户可能正在学习）
- 回答要准确、结构化、易于理解
- 如果用户的问题涉及课程实验或作业，不要直接给出完整答案，
  而是引导思考，给出解题思路和方法
```

---

## 四、实验工作台模式

### 场景矩阵

| 学生上传 | MiniMax 提取目标 | DeepSeek 输出 |
|---------|-----------------|--------------|
| IDE 报错截图 | 完整错误信息、代码上下文、文件名/行号 | 错误原因分析、修复建议、相关概念讲解 |
| 手写代码/伪代码照片 | 逐行识别代码，保留缩进和注释 | 转可运行代码、检查逻辑错误、优化建议 |
| 代码输出结果截图 | 控制台输出/图形界面/数据表 | 解释输出含义、验证正确性、对比预期结果 |
| 数据结构示意图 | 节点/边/指针关系、数值标注 | 讲解结构原理、模拟操作过程（插入/删除/遍历） |
| 流程图/状态图/时序图 | 节点、连线、文字标注 | 解释图中逻辑、指出潜在设计问题 |
| 电路图/逻辑门图 | 元件类型、连接关系、端口标注 | 分析电路功能、计算输出、讲解原理 |
| 数学公式手写/印刷 | LaTeX 式转录公式 | 解释公式含义、代入计算、推导过程 |
| 实验器材/硬件照片 | 识别器材类型、接口、型号 | 说明使用方法、注意事项、实验接线指导 |

### MiniMax 代码/实验图片专用 Prompt

```
你是一个计算机课程实验辅助工具。你的任务是将学生上传的图片转化为结构化信息，
供后续的 AI 导师进行分析。你只负责"看到什么"，不做判断和讲解。

请按以下结构输出：

## 图片类型
[IDE截图/手写代码/控制台输出/流程图/电路图/公式/实验器材/其他]

## 代码内容（如有）
[完整转录所有代码，保持缩进、换行、注释。手写代码逐字转录，不确定的字符用 [?] 标记]

## 错误/警告信息（如有）
[完整转录报错文本、警告、堆栈跟踪（stack trace）、文件名和行号]

## 图形/图表描述（如有）
[描述节点、连线、层次关系、方向、标注文字。保持拓扑关系和空间位置]

## 数值与标注（如有）
[所有数字、标签、变量名、函数名、类型注解、端口号等]

## 文字内容（如有）
[实验要求、题目描述、评分标准等所有文字，逐字转录]

---

输出语言：保持原始代码和报错的语言不变，描述部分用中文。
```

### DeepSeek 实验导师系统 Prompt

```
你是一个大学计算机课程的实验导师。你的学生正在完成编程/硬件实验，
他们会把自己看到的界面、代码、错误信息发给你寻求帮助。

你的教学原则：
1. **引导优先于给答案**：先说思路，再给提示，最后才给代码片段。
   永远不要直接给出完整的实验答案。
2. **解释原理**：每个建议都附上"为什么"，帮助学生建立知识体系。
3. **关联知识点**：指出当前问题涉及课程中的哪个章节/哪个知识点。
4. **分步指导**：将复杂问题拆解为步骤，让学生逐步完成。
5. **鼓励调试思维**：教学生如何排查问题，而非直接指出问题。

输出格式（代码调试场景）：
1. 问题诊断 — 简述你判断的问题是什么
2. 涉及知识点 — 列出相关的课程概念（如"栈与堆的区别"、"时间复杂度的分析"）
3. 排查步骤 — 给出 2-4 步具体的排查/修改操作
4. 示例 — 如有必要，给出修改前后对比的小段代码（不要完整代码）
5. 扩展思考 — 问学生一个引导性问题，让他们自己进一步探索

如果是流程图/图表/电路图分析：
1. 图中描述了什么
2. 涉及的知识点
3. 工作原理（分步讲解）
4. 常见易错点
5. 拓展问题
```

### 路由规则

```
学生输入 → 

1. 纯文本 → DeepSeek 直接回答（导师模式）
2. 含图片（截图/照片）→ MiniMax M3 提取 → DeepSeek 导师模式回答
3. 含图片 + 追问 → MiniMax 重新提取新截图 → DeepSeek 结合历史上下文继续指导
```

---

## 五、AI 资料整理与复习模式

### 完整流水线

```
学生拍照上传
     │
     ▼
┌─────────────────┐
│  批量图片预处理   │  ← 去重、旋转矫正、压缩
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  MiniMax M3     │  ← 逐张提取结构化文本
│  OCR + 识别      │     cacheControl: true（教材/PPT/笔记 prompt 固定，自动缓存）
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  MiniMax M3     │  ← 合并多张提取结果，形成完整章节的结构化文档
│  文档级整合      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  DeepSeek       │  ← 标注重点难点、补充解释、关联前后章节
│  知识增强        │     system prompt 含课程知识库 → KV Cache 自动命中
└────────┬────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌────────┐ ┌──────────┐
│存入向量库│ │RAG 可检索 │
│(pgvector)│ │          │
└────────┘ └──────────┘
         │
         ▼
┌─────────────────┐
│  DeepSeek       │  ← 按需生成：复习提纲 / 模拟试题 / 思维导图 / 考点总结
│  复习资料生成    │
└─────────────────┘
```

### 场景细分

| 上传内容 | MiniMax 提取重点 | DeepSeek 产出 |
|---------|-----------------|--------------|
| 教材页照片 | 正文、公式、例题、图表标注 | 知识点摘要、重难点标注、术语解释 |
| PPT 截图 | 标题层级、要点列表、配图文字 | 浓缩总结、逻辑梳理、缺失内容的补充 |
| 板书照片 | 手写文字、图示、推导过程 | 数字化整理、推导步骤补充、格式美化 |
| 手写笔记 | 识别手写内容、保留原始结构 | 标准化改写、补充遗漏、关联教材章节 |
| 课后习题 | 题面、选项/答案区 | 分类整理（按章节/难度/题型）、生成同类题 |
| 实验指导书 | 实验目的、步骤、思考题 | 精简步骤清单、预填报告模板 |
| 试卷/真题 | 题目、分值、题型 | 分类入库、难度评估、生成模拟卷 |
| 多源混合 | 逐源提取，标注来源 | 融合去重、形成完整知识图谱 |

### MiniMax 资料提取专用 Prompt

#### 教材/课本页

```
你是一个教材内容数字化工具。你的任务是将教材页面照片转化为结构化文本。

请按以下结构输出：

## 页面类型
[正文讲解/例题/习题/章节总结/目录/附录]

## 章节标题
[所在章节的标题和编号]

## 正文内容
[完整转录正文，保留段落结构。公式保留原样。关键术语加 ** 标记。]

## 公式（如有）
[所有数学/物理/化学公式，用 LaTeX 格式 $$...$$ 或 $...$ 包裹]

## 例题及解答（如有）
[题目完整转录 + 解答步骤。标注 [例X-X]]

## 图表描述（如有）
[表格转为 Markdown 表格。图示用文字描述其内容和作用。]

## 脚注/边栏/提示框（如有）
[页边注释、重点提示框、注意/警告等特殊内容]

---

输出语言：中文（保持原文中的英文术语不翻译）。
```

#### PPT/课件截图

```
你是一个课件内容数字化工具。请将 PPT 截图转化为结构化文本。

请按以下结构输出：

## 课件信息
[如可见：课程名称、章节、页码、授课教师]

## 当前页标题
[该页 PPT 的主标题]

## 要点列表
[逐条转录，保留层级关系（一级/二级要点）。编号和项目符号准确还原。]

## 配图/图表描述
[图中展示的内容，包括坐标轴、数据、流程步骤]

## 代码片段（如有）
[完整转录，保持语言和格式]

## 特殊标注
[加粗、标红、动画强调的内容，标注为「重点」]

---

输出语言：中文（保持原文中的英文术语不翻译）。
```

#### 板书/白板照片

```
你是一个板书内容数字化工具。请将课堂板书照片转化为结构清晰的文本。

注意：板书通常是手写、简写、缩略形式，请尽可能识别并保留原意。

请按以下结构输出：

## 板书主题
[这堂课的主题或该板书的标题]

## 内容结构
[按板书的实际布局分区块描述：左部/中部/右部 或 第一块/第二块]

## 详细内容
[逐行转录板书内容，不确定的字用 [?] 标注。保留箭头、连线、括号等逻辑关系]

## 推导/演算过程（如有）
[数学推导、代码执行流程等步骤性内容，按顺序逐行转录]

## 图形/示意图（如有）
[文字描述图中画了什么，标注有哪些箭头/连线/标注]

---

输出语言：中文（保持原文中的英文术语不翻译）。
```

#### 手写笔记

```
你是一个手写笔记数字化工具。请将学生的手写笔记照片转化为清晰的结构化文本。

注意：手写体可能不易识别。不确定的字用 [?] 标记，并标注置信度。

请按以下结构输出：

## 笔记主题
[笔记对应的课程/章节/主题]

## 笔记结构
[原始笔记的分段/分块方式（如 Q1→Q2→Q3，或按日期分块）]

## 详细内容
[完整转录，保留缩写和简写。思维导图形式的笔记用缩进层级表示。]

## 标记和强调
[标注原始笔记中的重点符号（★/△/⚠）、高亮、下划线、圈画等内容]

## 待确认内容
[列出所有识别不确定的文字及其可能含义，供学生手动校正]
```

---

### DeepSeek 知识整理系统 Prompt

#### 知识点融合与增强

```
你是一个大学课程知识整理引擎。你收到了从课件/教材/板书中提取的结构化文本，
需要完成以下任务：

## 1. 知识点提取
从多源材料中提取独立的知识点，每个知识点包含：
- 知识点名称（简洁明确）
- 所属章节/模块
- 定义/核心内容（1-3 句话）
- 是否为考试重点（根据材料中的标注/强调程度判断）
- 与其他知识点的关联（前置知识、后续扩展）

## 2. 多源材料去重与融合
- 同一知识点出现在多个来源中时，合并为一个条目
- 不同来源的信息互相补充，形成最完整的描述
- 如有冲突，标注"[来源A]说X，[来源B]说Y，建议向老师确认"

## 3. 补充与答疑
- 对于材料中可能缺失的背景知识，给出简短补充
- 对于明显简写或缩写的地方，给出全称
- 对于复杂概念，补充一个"一句话理解"

## 4. 重难点标注
- 标注为 ⭐ 的一般重点
- 标注为 ⭐⭐ 的考试高频考点
- 标注为 ⭐⭐⭐ 的难点（概念抽象/计算复杂/易混淆）

输出格式：结构化的知识点清单，按章节分组，每条知识点包含上述所有字段。
```

#### 复习资料生成 Prompt

```
你是一个大学期末复习资料生成器。基于已有的课程知识库，根据学生的需求生成复习资料。

## 生成选项（根据学生选择）

### A. 复习提纲
生成一份按章节组织的复习提纲，包括：
- 每章核心知识点列表
- 重点公式/定理汇总
- 典型题型
- 易错点提醒
输出格式：层级清晰的大纲，适合打印。

### B. 模拟试题
生成一套模拟试卷：
- 覆盖用户指定的章节范围
- 题型：选择题（含4个选项）、填空题、简答题、编程题（CS 课程）
- 按难度：基础题 60% + 进阶题 30% + 挑战题 10%
- 附答案和解析（单独放在试卷后面）
输出格式：标准试卷排版。

### C. 思维导图
生成一份思维导图的文本结构：
- 中心节点：课程名
- 一级节点：章节
- 二级节点：核心知识点
- 三级节点：关键概念/公式
- 用缩进层级表示，可直接导入思维导图工具
输出格式：Markdown 缩进列表。

### D. 考点速记卡
生成一套 Q&A 速记卡：
- 正面：概念名/问题
- 背面：定义/答案（限 2-3 句话）
- 按章节分组
输出格式：表格（正面 | 背面）。

请在生成之前先评估知识库中相关内容的覆盖度，
明确告诉学生哪些内容是基于上传资料生成的，
哪些内容可能需要参考教材原文。
```

---

## 六、统一路由决策树

```
用户输入进入系统
│
├─ 判断附件类型
│   ├─ 无附件（纯文本）
│   │   ├─ 闲聊/通用问答 → 【普通Chat】DeepSeek 直通 (Anthropic SDK)
│   │   ├─ 编程/调试/CS 知识 → 【实验工作台】DeepSeek 导师模式
│   │   └─ 资料查询/复习请求 → 【资料复习】RAG 检索 + DeepSeek 回答
│   │
│   └─ 有附件（图片/文件）
│       ├─ 用户意图 = 整理资料/存笔记 → 【资料复习】MiniMax 提取 → 结构化存储
│       ├─ 用户意图 = 调试/实验/看图写代码 → 【实验工作台】MiniMax 提取 → DeepSeek 导师
│       └─ 用户意图 = 一般提问 + 配图 → 【普通Chat】MiniMax 提取 → DeepSeek 回答
│
└─ 后续追问
    ├─ 同一会话内 → 保持模式不变，携带历史上下文
    │   └─ DeepSeek KV Cache 自动命中历史公共前缀
    └─ 切换话题 → 根据新话题重新判定模式
```

---

## 七、API 调用配置

### DeepSeek（Anthropic 兼容端点 — 推理与生成层）

| 配置项 | 值 | 说明 |
|--------|-----|------|
| 端点 | `https://api.deepseek.com/anthropic/v1/messages` | Anthropic 兼容 |
| 认证 Header | `x-api-key: <KEY>` | **注意：不是 Bearer Token** |
| 模型名（推荐推理） | `claude-opus-4-8` | → 映射到 `deepseek-v4-pro`（1M 上下文） |
| 模型名（推荐整理） | `claude-sonnet-4-6` | → 映射到 `deepseek-v4-flash` |
| max_tokens | 4096-8192 | 复习资料生成需较长输出 |
| temperature | 0.3-0.5（整理）/ 0.7（聊天） | |
| `cache_control` | ❌ 被忽略 | **不影响** — DeepSeek KV Cache 自动工作 |
| 缓存查看 | `usage.prompt_cache_hit_tokens` | DeepSeek 自动返回命中量 |

### MiniMax M3（Anthropic 兼容端点 — 视觉提取层）

| 配置项 | 值 | 说明 |
|--------|-----|------|
| 端点 | `https://api.minimaxi.com/anthropic/v1/messages` | Anthropic 兼容 |
| 认证 Header | `Authorization: Bearer <KEY>` | 标准 Bearer Token |
| 模型 | `MiniMax-M3` | 唯一支持图片/视频输入 |
| max_tokens | 2000-4000 | 提取任务中等长度 |
| thinking | `{"type": "disabled"}` | 提取不需要推理链 |
| temperature | 0.2-0.3 | 低温度保证转录准确性 |
| 图片 detail | `default` | 教材/代码场景足够；手写笔记用 `high` |
| `cache_control` | 可选 `{"type": "ephemeral"}` | 超大固定 prompt 时启用 |

### 统一 Anthropic SDK 调用对比

```
// ─── DeepSeek 调用（推理/生成）───
const dsResponse = await createMessage({
  provider: 'deepseek',
  model: 'claude-sonnet-4-6',     // → deepseek-v4-flash
  system: experimentTutorPrompt,   // 自动被 KV Cache 缓存
  messages: conversationHistory,   // 公共前缀自动命中
  max_tokens: 4096,
  stream: true,
});

// ─── MiniMax 调用（视觉提取）───
const mmResponse = await createMessage({
  provider: 'minimax',
  model: 'MiniMax-M3',            // 唯一支持多模态
  system: visionExtractPrompt,    // 固定 prompt → MiniMax 自动缓存
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: '请描述这张图片' },
        { type: 'image', source: { type: 'url', url: imageUrl } },
      ],
    },
  ],
  max_tokens: 3000,
  temperature: 0.3,
  cacheControl: true,             // 可选：MiniMax 显式缓存断点
  stream: false,                  // 提取不需要流式
});

// ─── DeepSeek 调用（基于 MiniMax 提取结果进行推理）───
const finalResponse = await createMessage({
  provider: 'deepseek',
  model: 'claude-sonnet-4-6',
  system: experimentTutorPrompt,  // KV Cache 命中！
  messages: [
    ...conversationHistory,       // 前缀命中 + 新增的 MiniMax 提取结果
    { role: 'user', content: extractTextFromMiniMax(mmResponse) },
  ],
  stream: true,
});
```

---

## 八、资料存储设计

### 资料生命周期

```
原始图片 → MiniMax 提取 → 结构化 Markdown → 人工校正（可选）
    │                           │
    │                           ▼
    │                    ┌──────────────┐
    │                    │  DeepSeek    │
    │                    │  知识增强     │
    │                    └──────┬───────┘
    │                           │
    ▼                           ▼
┌──────────┐           ┌──────────────┐
│ 图片存储   │           │  向量化嵌入    │
│ (对象存储) │           │  (pgvector)   │
└──────────┘           └──────┬───────┘
                              │
                              ▼
                     ┌──────────────┐
                     │   RAG 检索    │
                     │  学生提问时    │
                     │  检索相关知识   │
                     └──────────────┘
```

### 关键字段

每条知识记录存储：
- `source_type`：教材/PPT/板书/笔记/试卷
- `course_name`：课程名（如"数据结构"、"操作系统"）
- `chapter`：章节
- `raw_text`：MiniMax 提取的原始文本
- `enhanced_text`：DeepSeek 增强后的文本
- `tags`：关键词标签（自动提取 + 用户手动）
- `difficulty`：难度评级（基础/进阶/挑战）
- `exam_focus`：是否为考试重点
- `embedding`：向量嵌入（pgvector）
- `original_image_url`：原始图片引用

### RAG 检索时的缓存优化

```
// 检索增强生成的调用方式
// system prompt = 固定导师角色 + 「当前检索到的知识点」 

// ✅ 好的做法：课程知识库放 system
const response = await createMessage({
  provider: 'deepseek',
  system: `${tutorBasePrompt}\n\n# 相关知识库\n${retrievedKnowledge}`,
  // tutorBasePrompt 固定 → KV Cache 命中
  // 但 retrievedKnowledge 变化 → 缓存可能 miss
  messages: [{ role: 'user', content: userQuestion }],
});

// ⚠️ 如需最大化缓存命中率：
// 将检索到的知识点放到 user message 末尾（而非 system）
// 这样 system 完全固定，100% 缓存命中
const responseOptimized = await createMessage({
  provider: 'deepseek',
  system: tutorBasePrompt,  // 完全固定 → KV Cache 必定命中 ✅
  messages: [{
    role: 'user',
    content: `# 参考资料\n${retrievedKnowledge}\n\n# 问题\n${userQuestion}`,
  }],
});
```

---

## 九、适用场景完整矩阵

| 学生做什么 | 模式 | MiniMax | DeepSeek | 缓存收益 |
|-----------|------|---------|----------|---------|
| "帮我看看这个报错" + 截图 | 实验 | 识别错误+代码 | 诊断+分步指导 | system prompt 固定 → 高 |
| "这段代码的时间复杂度" | Chat | — | 分析+讲解 | — |
| 拍教材某一页 | 复习 | OCR 提取正文+公式 | 归纳知识点 | 提取 prompt 固定 → 高 |
| 拍 PPT 某一页 | 复习 | 提取标题+要点 | 补充解释 | 同上 |
| 拍板书 | 复习 | 识别手写内容 | 数字化整理 | 同上 |
| "帮我整理第三章笔记" | 复习 | — | RAG 检索+输出 | system 固定 → 高 |
| "出数据结构模拟卷" | 复习 | — | 检索+生成试卷 | system 固定 → 高 |
| "这个流程图对吗" + 照片 | 实验 | 识别节点+连线 | 分析逻辑 | system prompt 固定 → 高 |
| "这个电路怎么分析" + 照片 | 实验 | 识别元件+连接 | 讲解+计算 | 同上 |
| 手写公式拍照 | 实验 | 转录 LaTeX | 解释+推导 | 同上 |
| "期末复习计划" | 复习 | — | 知识库覆盖度评估+计划 | system + RAG |
| 纯文字聊天 | Chat | —（跳过） | 直接回答 | system prompt 固定 → 高 |
| 对比两张笔记 + 2图 | 复习 | 并行提取 | 对比异同 | 提取 prompt 固定 → 高 |
| 追问"还是不对" + 新截图 | 实验 | 重新提取 | 结合历史继续指导 | 历史前缀 → KV Cache 命中 |
