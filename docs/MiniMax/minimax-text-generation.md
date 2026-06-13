# MiniMax 模型调用指南

> 来源: https://platform.minimaxi.com/docs/guides/text-generation

## 模型概览

MiniMax 提供多款语言模型。**MiniMax-M3** 是最新的 M 系列模型，面向 Agent 推理、工具调用、代码和长上下文任务。

## 支持的模型

| 模型 | 上下文窗口 | 说明 |
|------|-----------|------|
| MiniMax-M3 | 1,000,000 | 原生多模态、1M 上下文 Frontier Coding 模型 |
| MiniMax-M2.7 | 204,800 | 自我迭代，~60 TPS |
| MiniMax-M2.7-highspeed | 204,800 | M2.7 高速版，~100 TPS |
| MiniMax-M2.5 | 204,800 | 顶级性能与性价比，~60 TPS |
| MiniMax-M2.5-highspeed | 204,800 | M2.5 高速版，~100 TPS |
| MiniMax-M2.1 | 204,800 | 强大多语言编程，~60 TPS |
| MiniMax-M2.1-highspeed | 204,800 | M2.1 高速版，~100 TPS |
| MiniMax-M2 | 204,800 | 高效编码与 Agent 工作流 |
| M2-her | 64K | 专为对话、角色扮演和多轮对话设计 |

---

## URL 配置

| 配置项 | 值 |
|--------|-----|
| `base_url`（Anthropic 兼容，推荐） | `https://api.minimaxi.com/anthropic` |
| `base_url`（OpenAI 兼容） | `https://api.minimaxi.com/v1` |
| `api_key` | 在订阅 Key 页面获取 |
| `model` | 见上表 |

---

## Anthropic 兼容调用（推荐）

支持 thinking blocks、交错思维链等高级特性，是默认推荐路径。

```bash
curl https://api.minimaxi.com/anthropic/v1/messages \
  -H "Authorization: Bearer <MINIMAX_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "MiniMax-M3",
    "max_tokens": 1000,
    "messages": [
      {"role": "user", "content": "Hi, how are you?"}
    ]
  }'
```

```python
import anthropic

client = anthropic.Anthropic(
    base_url="https://api.minimaxi.com/anthropic",
    api_key="<MINIMAX_API_KEY>",
)

message = client.messages.create(
    model="MiniMax-M3",
    max_tokens=1000,
    messages=[{"role": "user", "content": "Hi, how are you?"}],
)

for block in message.content:
    if block.type == "thinking":
        print(f"Thinking:\n{block.thinking}\n")
    elif block.type == "text":
        print(f"Text:\n{block.text}\n")
```

```javascript
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  baseURL: "https://api.minimaxi.com/anthropic",
  apiKey: "<MINIMAX_API_KEY>",
});

const message = await client.messages.create({
  model: "MiniMax-M3",
  max_tokens: 1000,
  messages: [{ role: "user", content: "Hi, how are you?" }],
});

for (const block of message.content) {
  if (block.type === "thinking") {
    console.log(`Thinking:\n${block.thinking}\n`);
  } else if (block.type === "text") {
    console.log(`Text:\n${block.text}\n`);
  }
}
```

---

## OpenAI 兼容调用

已使用 OpenAI SDK 的项目只需更换 `base_url` 和 `model`：

```bash
curl https://api.minimaxi.com/v1/chat/completions \
  -H "Authorization: Bearer <MINIMAX_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "MiniMax-M3",
    "messages": [
      {"role": "user", "content": "Hi, how are you?"}
    ]
  }'
```

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://api.minimaxi.com/v1",
    api_key="<MINIMAX_API_KEY>",
)

response = client.chat.completions.create(
    model="MiniMax-M3",
    messages=[{"role": "user", "content": "Hi, how are you?"}],
)

print(response.choices[0].message.content)
```

```javascript
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://api.minimaxi.com/v1",
  apiKey: "<MINIMAX_API_KEY>",
});

const response = await client.chat.completions.create({
  model: "MiniMax-M3",
  messages: [{ role: "user", content: "Hi, how are you?" }],
});

console.log(response.choices[0].message.content);
```

---

## MiniMax M3 核心亮点

- **1M 上下文**：支持高达 1M tokens 的长文档、代码库和多步 Agent 会话
- **Agent & Code**：面向 Agent 推理、工具调用、代码和结构化任务执行优化
- **多模态对话输入**：OpenAI 兼容的 Chat Completions 端点接受 text、image、video 输入

## 联系方式

- Email: Model@minimaxi.com
- GitHub Issues: https://github.com/MiniMax-AI/MiniMax-M2.7/issues
