# DeepSeek 多轮对话

## 核心概念

DeepSeek 对话 API 采用**无状态设计**——服务端不会保存对话历史。用户需在每次请求时将完整的对话历史拼接好并传递。

## 工作原理

1. **第一轮**: 发送用户消息到 `/chat/completions`，接收模型回复
2. **后续轮次**: 将之前所有的 `user` 和 `assistant` 消息一同发送，加上新的用户提问

## 消息格式

```json
{
  "model": "deepseek-v4-pro",
  "messages": [
    {"role": "user", "content": "Hello, who are you?"},
    {"role": "assistant", "content": "I'm DeepSeek, an AI assistant."},
    {"role": "user", "content": "Tell me more about yourself."}
  ]
}
```

## 代码示例 (Python)

```python
from openai import OpenAI

client = OpenAI(
    api_key="your-api-key",
    base_url="https://api.deepseek.com"
)

messages = []

# Round 1
messages.append({"role": "user", "content": "What is Python?"})
response = client.chat.completions.create(
    model="deepseek-v4-pro",
    messages=messages
)
reply = response.choices[0].message
messages.append({"role": "assistant", "content": reply.content})

# Round 2
messages.append({"role": "user", "content": "Show me a code example."})
response = client.chat.completions.create(
    model="deepseek-v4-pro",
    messages=messages
)
```

## 关键提示

- 每次请求都会重新处理所有历史消息
- 对话越长，token 消耗越大
- 注意模型的上下文窗口限制（1M tokens）
- 建议在接近上下文限制时截断或总结早期对话内容
