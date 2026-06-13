# DeepSeek Chat Completions API

## 端点

```
POST https://api.deepseek.com/chat/completions
```

## 认证

```
Authorization: Bearer <DEEPSEEK_API_KEY>
Content-Type: application/json
```

## 请求体

```json
{
  "model": "deepseek-v4-pro",
  "messages": [
    {"role": "system", "content": "You are a helpful assistant"},
    {"role": "user", "content": "Hello"}
  ],
  "stream": false,
  "thinking": {"type": "enabled"},
  "reasoning_effort": "high",
  "max_tokens": 4096,
  "temperature": 1.0,
  "user_id": "user-123"
}
```

### 参数说明

| 参数 | 必填 | 类型 | 说明 |
|------|------|------|------|
| `model` | 是 | string | 模型名称 |
| `messages` | 是 | array | 消息数组 |
| `stream` | 否 | boolean | 是否流式输出，默认 false |
| `thinking` | 否 | object | 思考模式 `{"type": "enabled"|"disabled"}` |
| `reasoning_effort` | 否 | string | 推理强度 `"high"` 或 `"max"` |
| `max_tokens` | 否 | integer | 最大生成 token 数 |
| `temperature` | 否 | float | 采样温度 0.0–2.0（思考模式下忽略） |
| `top_p` | 否 | float | 核采样（思考模式下忽略） |
| `user_id` | 否 | string | 用户标识（用于隔离和统计） |

### message 对象

```json
{
  "role": "system|user|assistant|tool",
  "content": "消息内容"
}
```

## 响应格式

### 非流式

```json
{
  "id": "chatcmpl-xxx",
  "object": "chat.completion",
  "created": 1700000000,
  "model": "deepseek-v4-pro",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Hello! How can I help you today?"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 8,
    "total_tokens": 18,
    "prompt_cache_hit_tokens": 0,
    "prompt_cache_miss_tokens": 10
  }
}
```

### 流式 (SSE)

```
data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":""}}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hello"}}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"!"}}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":""},"finish_reason":"stop"}],"usage":{...}}

data: [DONE]
```

## 思考模式

启用思考模式后，模型会先进行思维链推理，再输出最终答案。思考内容通过 `delta.reasoning_content` 字段返回。

### 约束

- 思考模式下 `temperature`、`top_p`、`presence_penalty`、`frequency_penalty` 参数不生效
- 非工具调用场景中，多轮对话时不需要回传 `reasoning_content`
- 工具调用场景中，必须完整回传所有 `reasoning_content`，否则返回 400 错误

## SDK 示例

### Python (OpenAI SDK)

```python
from openai import OpenAI

client = OpenAI(
    api_key="your-deepseek-api-key",
    base_url="https://api.deepseek.com"
)

response = client.chat.completions.create(
    model="deepseek-v4-pro",
    messages=[
        {"role": "system", "content": "You are a helpful assistant"},
        {"role": "user", "content": "Hello"},
    ],
    stream=False,
    reasoning_effort="high",
    extra_body={"thinking": {"type": "enabled"}}
)

print(response.choices[0].message.content)
```

> **注意**: 使用 OpenAI SDK 时，`thinking` 参数需通过 `extra_body` 传入。

### Node.js

```javascript
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: "your-deepseek-api-key",
  baseURL: "https://api.deepseek.com",
});

const completion = await openai.chat.completions.create({
  messages: [{ role: "system", content: "You are a helpful assistant." }],
  model: "deepseek-v4-pro",
  thinking: { type: "enabled" },
  reasoning_effort: "high",
  stream: false,
});

console.log(completion.choices[0].message.content);
```

### cURL

```bash
curl https://api.deepseek.com/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $DEEPSEEK_API_KEY" \
  -d '{
    "model": "deepseek-v4-pro",
    "messages": [{"role": "user", "content": "Hello"}],
    "thinking": {"type": "enabled"},
    "reasoning_effort": "high",
    "stream": false
  }'
```
