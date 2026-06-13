# MiniMax Messages API（Anthropic 兼容）

> 来源: https://platform.minimaxi.com/docs/api-reference/text-chat-anthropic

## 端点

**POST** `https://api.minimaxi.com/anthropic/v1/messages`

认证方式：`Authorization: Bearer <API_KEY>` 或 `x-api-key: <API_KEY>`（两者同时存在时，Authorization 优先）

---

## 请求参数

| 参数 | 必需 | 说明 |
|------|------|------|
| `model` | 是 | 模型 ID。M3 支持 text/image/video/tool/thinking；M2.x 系列仅 text + tools |
| `messages` | 是 | 对话历史，消息对象数组 |
| `stream` | 否 | 布尔值，默认 false；启用 SSE 流式 |
| `max_tokens` | 否 | 生成 token 限制（M3: 推荐 128K，最大 512K；其他: 推荐 64K，最大 200K） |
| `temperature` | 否 | 范围 [0, 2]，默认 1 |
| `top_p` | 否 | 范围 [0, 1]；M3 默认 0.95，M2.x 默认 0.9 |
| `system` | 否 | 系统提示词，支持字符串或 content block 数组（支持 `cache_control`） |
| `tools` | 否 | Anthropic 兼容的工具定义（name, description, input_schema） |
| `tool_choice` | 否 | 对象，type 为 `auto` 或 `none` |
| `thinking` | 否 | 对象，type 为 `disabled` 或 `adaptive`；M3 默认 disabled |
| `metadata` | 否 | 支持 `user_id` 用于按用户限流和计费 |
| `service_tier` | 否 | `standard`（默认）或 `priority`（1.5× 定价，优先队列） |

### 支持的模型

`MiniMax-M3`, `MiniMax-M2.7`, `MiniMax-M2.7-highspeed`, `MiniMax-M2.5`, `MiniMax-M2.5-highspeed`, `MiniMax-M2.1`, `MiniMax-M2.1-highspeed`, `MiniMax-M2`

---

## 消息内容块（请求）

支持的 `type` 类型：

| 类型 | 说明 |
|------|------|
| `text` | 文本内容 |
| `image` | 图片（URL 或 base64）；支持 JPEG, PNG, GIF, WEBP；最大 10 MB |
| `video` | 视频（URL、base64 或 `mm_file://{file_id}`）；支持 MP4, AVI, MOV, MKV；URL/base64 最大 50 MB，Files API 最大 512 MB |
| `tool_use` | 回传先前的助手工具调用（需要 id, name, input） |
| `tool_result` | 工具执行结果，引用 `tool_use_id` |
| `thinking` | 回传先前的助手思考内容（必须包含 `signature` 以保持多轮连续性） |

### 图片参数

- `detail`：`low` / `default` / `high`（控制分析深度）
- Token 估算：low ~几百 tokens (max ~600)，default ~1k-3k (max ~5k)，high ~几千 (max ~15k+)

### 视频参数

- `fps`：0.2-5，默认 1（帧采样率，越高 tokens/成本越多）
- `max_long_side_pixel`：每帧最长边像素限制

---

## 响应内容块

响应包含内容块数组，类型为 `text`、`tool_use` 或 `thinking`。

响应结构：
- `id`：唯一响应标识
- `type`：始终 `"message"`
- `role`：始终 `"assistant"`
- `model`：使用的模型
- `content`：响应内容块数组
- `stop_reason`：`end_turn` / `max_tokens` / `tool_use`
- `usage`：token 计数（`input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`）

### thinking 块

包含模型的推理 trace 和 `signature` 字段。在多轮对话中，必须原样返回 `signature` 以保持连续性。

---

## 流式事件

当 `stream: true` 时，使用 SSE 事件：

| 事件 | 用途 |
|------|------|
| `message_start` | 初始元数据（ID, model, usage） |
| `ping` | 心跳 |
| `content_block_start` | 新内容块开始（含 index 和 content_block） |
| `content_block_delta` | 增量更新（`text_delta`, `thinking_delta`, `signature_delta`） |
| `content_block_stop` | 内容块完成 |
| `message_delta` | 消息级别更新（stop_reason, 最终 usage） |
| `message_stop` | 流终止 |

---

## 错误响应

统一 JSON 结构：`{ type: "error", request_id, error: { type, message } }`

| HTTP 状态码 | 错误类型 | 场景 |
|-------------|---------|------|
| 400 | `invalid_request_error` | 无效参数、不支持的内容类型 |
| 401 | `authentication_error` | 缺少或无效 API key |
| 403 | `permission_error` | 无权限访问模型或路径 |
| 404 | `not_found_error` | 模型未找到 |
| 413 | `request_too_large` | 请求体 > 64 MB 或媒体超限 |
| 429 | `rate_limit_error` | RPM/TPM/并发限流 |
| 500 | `api_error` | 内部服务器错误 |
| 529 | `overloaded_error` | 上游模型过载，可重试 |

流式错误通过 `event: error` SSE 事件传递，body 结构相同。

---

## 使用示例

### 图片理解

```python
import anthropic

client = anthropic.Anthropic(
    base_url="https://api.minimaxi.com/anthropic",
    api_key="<MINIMAX_API_KEY>",
)

message = client.messages.create(
    model="MiniMax-M3",
    max_tokens=500,
    messages=[{
        "role": "user",
        "content": [
            {"type": "text", "text": "这张图片的内容是什么？"},
            {
                "type": "image",
                "source": {
                    "type": "url",
                    "url": "https://example.com/image.jpg"
                }
            }
        ]
    }]
)

for block in message.content:
    if block.type == "thinking":
        print(f"Thinking:\n{block.thinking}\n")
    elif block.type == "text":
        print(f"Text:\n{block.text}\n")
```

### 视频理解

```python
message = client.messages.create(
    model="MiniMax-M3",
    max_tokens=500,
    messages=[{
        "role": "user",
        "content": [
            {"type": "text", "text": "这个视频里发生了什么？"},
            {
                "type": "video",
                "source": {
                    "type": "url",
                    "url": "https://example.com/video.mp4"
                }
            }
        ]
    }]
)
```

### 流式调用

```python
with client.messages.stream(
    model="MiniMax-M3",
    max_tokens=500,
    messages=[{"role": "user", "content": "Hello"}]
) as stream:
    for event in stream:
        if event.type == "content_block_delta":
            if event.delta.type == "thinking_delta":
                print(event.delta.thinking, end="", flush=True)
            elif event.delta.type == "text_delta":
                print(event.delta.text, end="", flush=True)
```

## 重要提示

1. 仅列出的 8 个 M 系列模型支持此兼容接口
2. temperature 超出 [0, 2] 会报错，推荐 1.0
3. 以下 Anthropic 原生参数会被静默忽略：`top_k`, `stop_sequences`, `mcp_servers`, `context_management`, `container`
4. 图片/视频输入仅 MiniMax-M3 支持；M2.x 仅接收文本和工具相关块
5. **多轮 Function Call 必须将完整的模型返回（assistant 消息）添加到对话历史**
