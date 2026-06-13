# MiniMax Chat Completions API（OpenAI 兼容）

> 来源: https://platform.minimaxi.com/docs/api-reference/text-chat-openai

## 端点

**POST** `https://api.minimaxi.com/v1/chat/completions`

认证：`Authorization: Bearer <API_KEY>`
必需 Header：`Content-Type: application/json`

---

## 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `model` | string | 是 | MiniMax-M3, M2.7, M2.7-highspeed, M2.5, M2.5-highspeed, M2.1, M2.1-highspeed, M2 |
| `messages` | array | 是 | 对话历史，支持 text、image、video、tool calls |
| `thinking` | object | 否 | 控制 M3 思考行为。省略默认 `adaptive`。`type`: `"disabled"` 或 `"adaptive"` |
| `reasoning_split` | boolean | 否 | 启用后思考内容分离到 `reasoning_content` 和 `reasoning_details` 字段 |
| `stream` | boolean | 否 | 启用流式，默认 false |
| `stream_options` | object | 否 | `include_usage` (boolean) 在流式响应中包含 token 用量 |
| `max_completion_tokens` | integer | 否 | M3: 推荐 128K，最大 512K；其他: 推荐 64K，最大 200K |
| `temperature` | number | 否 | [0, 2]，默认 1 |
| `top_p` | number | 否 | [0, 1]；M3 默认 0.95，M2.x 默认 0.9 |
| `service_tier` | string | 否 | `standard`（默认）或 `priority`（1.5× 定价） |
| `tools` | array | 否 | 工具定义，支持 `function` 类型 |
| `max_tokens` | integer | 否 | **已弃用**，使用 `max_completion_tokens` |

---

## Message 格式

| 字段 | 说明 |
|------|------|
| `role` | `system`, `user`, `assistant`, `tool` |
| `content` | 字符串或 `MessageContentPart` 数组（多模态） |
| `tool_calls` | 助手消息中的工具调用 |
| `tool_call_id` | `role=tool` 时必需，链接到先前的 tool_calls |

### MessageContentPart 类型

```json
// 文本
{ "type": "text", "text": "内容" }

// 图片
{
  "type": "image_url",
  "image_url": {
    "url": "https://... 或 data:image/jpeg;base64,...",
    "detail": "low" | "default" | "high",
    "max_long_side_pixel": 2048
  }
}

// 视频
{
  "type": "video_url",
  "video_url": {
    "url": "https://... 或 mm_file://{file_id}",
    "detail": "low" | "default" | "high",
    "fps": 1.0,
    "max_long_side_pixel": 2048
  }
}
```

### 媒体限制

| 类型 | URL/Base64 上限 | Files API 上限 | 支持格式 |
|------|----------------|---------------|---------|
| 图片 | 10 MB | - | JPEG, PNG, GIF, WEBP |
| 视频 | 50 MB | 512 MB (`mm_file://`) | MP4, AVI, MOV, MKV |
| 请求体 | 64 MB | - | - |

### 图片 Token 估算

- `low`: ~几百 tokens (max ~600)
- `default`: ~1k-3k (max ~5k)
- `high`: ~几千 (max ~15k+)

---

## 响应格式

```json
{
  "id": "...",
  "object": "chat.completion",
  "model": "MiniMax-M3",
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": "...",
      "reasoning_content": "...",    // reasoning_split=true 时
      "reasoning_details": [...],     // reasoning_split=true 时
      "tool_calls": [...]             // finish_reason=tool_calls 时
    },
    "finish_reason": "stop" | "length" | "content_filter" | "tool_calls"
  }],
  "usage": {
    "prompt_tokens": ...,
    "completion_tokens": ...,
    "total_tokens": ...,
    "prompt_tokens_details": { "cached_tokens": ... }
  }
}
```

### 内容审核字段

- `input_sensitive` / `output_sensitive`: 是否触发内容审核
- `input_sensitive_type` / `output_sensitive_type`: 审核类别（1=严重违规, 2=色情, 3=广告, 4=违禁, 5=辱骂, 6=暴恐, 7=其他）

---

## 使用示例

### 图片理解（非流式）

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://api.minimaxi.com/v1",
    api_key="<MINIMAX_API_KEY>",
)

response = client.chat.completions.create(
    model="MiniMax-M3",
    messages=[{
        "role": "user",
        "content": [
            {"type": "text", "text": "这张图片的内容是什么？"},
            {
                "type": "image_url",
                "image_url": {
                    "url": "https://example.com/image.jpg"
                }
            }
        ]
    }],
    max_completion_tokens=500
)

print(response.choices[0].message.content)
```

### 视频理解

```python
response = client.chat.completions.create(
    model="MiniMax-M3",
    messages=[{
        "role": "user",
        "content": [
            {"type": "text", "text": "这个视频里发生了什么？"},
            {
                "type": "video_url",
                "video_url": {
                    "url": "https://example.com/video.mp4"
                }
            }
        ]
    }],
    max_completion_tokens=500
)
```

### 工具调用

```python
response = client.chat.completions.create(
    model="MiniMax-M3",
    messages=[{"role": "user", "content": "旧金山现在天气怎么样？"}],
    tools=[{
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "获取指定地点的当前天气",
            "parameters": {
                "type": "object",
                "properties": {
                    "location": {
                        "type": "string",
                        "description": "城市和国家/地区, e.g. San Francisco, US"
                    }
                },
                "required": ["location"]
            }
        }
    }]
)

# finish_reason 会是 "tool_calls"
print(response.choices[0].message.tool_calls)
```

### 流式调用

```python
stream = client.chat.completions.create(
    model="MiniMax-M3",
    messages=[{"role": "user", "content": "Hello"}],
    stream=True,
    max_completion_tokens=500
)

for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="", flush=True)
```

### 思考模式（reasoning_split）

```python
response = client.chat.completions.create(
    model="MiniMax-M3",
    messages=[{"role": "user", "content": "9.11 和 9.9 哪个更大？"}],
    max_completion_tokens=500,
    thinking={"type": "adaptive"},
    extra_body={"reasoning_split": True}
)

# 思考内容在 reasoning_content 中
print(response.choices[0].message.reasoning_content)
print(response.choices[0].message.content)
```
