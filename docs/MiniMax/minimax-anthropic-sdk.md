# MiniMax Anthropic SDK 兼容指南

> 来源: https://platform.minimaxi.com/docs/api-reference/text-anthropic-api

开发者可以使用 Anthropic SDK 调用 MiniMax 模型，将 MiniMax 的能力接入 Anthropic API 生态。

---

## 快速开始

### 1. 安装 SDK

```bash
pip install anthropic
```
```bash
npm install @anthropic-ai/sdk
```

### 2. 配置环境变量

```bash
export ANTHROPIC_BASE_URL=https://api.minimaxi.com/anthropic
export ANTHROPIC_API_KEY=${YOUR_API_KEY}
```

### 3. 调用 API

```python
import anthropic

client = anthropic.Anthropic()

message = client.messages.create(
    model="MiniMax-M3",
    max_tokens=1000,
    system="You are a helpful assistant.",
    messages=[
        {"role": "user", "content": "Hi, how are you?"}
    ]
)

for block in message.content:
    if block.type == "thinking":
        print(f"Thinking:\n{block.thinking}\n")
    elif block.type == "text":
        print(f"Text:\n{block.text}\n")
```

---

## 兼容性：支持的参数

| 参数 | 支持状态 | 说明 |
|------|---------|------|
| `model` | ✅ 完全支持 | 仅 8 个 M 系列模型 |
| `messages` | ⚠️ 部分支持 | M3 支持 text/image/video/tool/thinking；M2.x 仅 text + tools |
| `max_tokens` | ✅ 完全支持 | 最大生成 token 数 |
| `stream` | ✅ 完全支持 | 流式响应 |
| `system` | ✅ 完全支持 | 系统提示词 |
| `temperature` | ✅ 完全支持 | 范围 [0, 2]，推荐 1 |
| `tool_choice` | ✅ 完全支持 | 工具选择策略 |
| `tools` | ✅ 完全支持 | 工具定义 |
| `top_p` | ✅ 完全支持 | 范围 [0, 1] |
| `thinking` | ✅ 完全支持 | M3 默认关闭，通过 `adaptive` 启用 |
| `metadata` | ✅ 完全支持 | 元数据 |
| `service_tier` | ✅ 完全支持 | `standard` 或 `priority` (1.5× 成本) |
| `top_k` | ❌ 被忽略 | — |
| `stop_sequences` | ❌ 被忽略 | — |
| `mcp_servers` | ❌ 被忽略 | — |
| `context_management` | ❌ 被忽略 | — |
| `container` | ❌ 被忽略 | — |

---

## Thinking 控制

### MiniMax-M3

- 不传 `thinking` 参数：thinking 关闭
- `thinking: {"type": "adaptive"}`：启用 thinking（对 M3，adaptive = on）
- `thinking: {"type": "disabled"}`：关闭 thinking

### M2.x 系列

- thinking **无法关闭**，即使传 `disabled` 也无效
- 响应中始终带有 thinking blocks

---

## Messages 字段支持详情

| 字段类型 | 支持 | 说明 |
|---------|------|------|
| `type="text"` | 完全支持 | 文本消息 |
| `type="image"` | 仅 M3 | URL 或 base64；支持 JPEG, PNG, GIF, WEBP |
| `type="video"` | 仅 M3 | URL, base64 或 `mm_file://{file_id}`；支持 MP4, AVI, MOV, MKV |
| `type="tool_use"` | 完全支持 | 工具调用 |
| `type="tool_result"` | 完全支持 | 工具结果 |
| `type="thinking"` | 完全支持 | 多轮对话中必须携带 |

### 媒体大小限制

- 视频（URL/base64）：最大 50 MB
- 图片：最大 10 MB
- 请求体：最大 64 MB
- 视频（Files API `mm_file://`）：最大 512 MB

---

## Token 计数

可通过 `POST /anthropic/v1/messages/count_tokens` 预先计算 M3 的 token 用量，不产生生成费用。

---

## 流式示例

```python
with client.messages.stream(
    model="MiniMax-M3",
    max_tokens=1000,
    messages=[{"role": "user", "content": "Hello"}]
) as stream:
    reasoning_buffer = ""
    text_buffer = ""

    for event in stream:
        if event.type == "content_block_delta":
            if event.delta.type == "thinking_delta":
                reasoning_buffer += event.delta.thinking
            elif event.delta.type == "text_delta":
                text_buffer += event.delta.text
```

---

## 注意事项

1. 仅 8 个 M 系列模型支持此兼容接口
2. temperature 超出 [0, 2] 会报错，推荐值 1.0
3. `top_k`、`stop_sequences`、`mcp_servers` 等参数会被静默忽略
4. 图片/视频输入仅 MiniMax-M3 支持
5. 多轮 Function Call 中，必须将完整的 `response.content`（含 thinking、text、tool_use 等）原样保留在对话历史中
