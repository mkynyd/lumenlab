# MiniMax-M3 工具使用与交错思维链

> 来源: https://platform.minimaxi.com/docs/guides/text-m3-function-call

## 概述

MiniMax-M3 是 Agentic Model，原生支持 **Interleaved Thinking（交错思维链）**，能够在每次工具调用之前基于环境或工具输出进行推理，再决定下一步行动。

**核心最佳实践：每轮都将模型的完整响应传回对话历史，特别是 thinking/reasoning 字段。**

---

## 多轮 Function Calling 关键规则

**必须将完整的 assistant 消息追加到对话历史中以保持思维链连续性。**

- **OpenAI SDK**：完整的 `response_message` 对象（含 `tool_calls`）放入历史。`reasoning_split=True` 时 thinking 通过 `reasoning_details` 单独提供，同样需要完整保留。
- **Anthropic SDK**：整个 `response.content` 列表（含 thinking, text, tool_use 等所有块）必须完整传回。

---

## Anthropic SDK 示例

```python
import anthropic

client = anthropic.Anthropic(
    base_url="https://api.minimaxi.com/anthropic",
    api_key="<MINIMAX_API_KEY>",
)

messages = [{"role": "user", "content": "旧金山现在的天气怎么样？"}]

tools = [{
    "name": "get_weather",
    "description": "获取指定地点的当前天气",
    "input_schema": {
        "type": "object",
        "properties": {
            "location": {
                "type": "string",
                "description": "城市和国家/地区, e.g. San Francisco, US"
            }
        },
        "required": ["location"]
    }
}]

# 第一轮
response = client.messages.create(
    model="MiniMax-M3",
    max_tokens=1000,
    tools=tools,
    messages=messages,
)

# 遍历响应内容
for block in response.content:
    if block.type == "thinking":
        print(f"Thinking: {block.thinking}")
    elif block.type == "text":
        print(f"Text: {block.text}")
    elif block.type == "tool_use":
        print(f"Tool call: {block.name}({block.input})")

# 关键：将完整响应追加到历史
messages.append({"role": "assistant", "content": response.content})

# 模拟工具结果
messages.append({
    "role": "user",
    "content": [{
        "type": "tool_result",
        "tool_use_id": response.content[-1].id,
        "content": "旧金山当前天气：晴天，18°C"
    }]
})

# 第二轮
response2 = client.messages.create(
    model="MiniMax-M3",
    max_tokens=1000,
    tools=tools,
    messages=messages,
)
```

---

## OpenAI SDK: Interleaved Thinking 友好格式

`extra_body={"reasoning_split": True}` 可将 thinking 与 content 分离：

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://api.minimaxi.com/v1",
    api_key="<MINIMAX_API_KEY>",
)

messages = [{"role": "user", "content": "旧金山现在天气怎么样？"}]

# 第一轮
response = client.chat.completions.create(
    model="MiniMax-M3",
    messages=messages,
    tools=[{
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "获取指定地点的当前天气",
            "parameters": {
                "type": "object",
                "properties": {
                    "location": {"type": "string", "description": "城市和国家/地区"}
                },
                "required": ["location"]
            }
        }
    }],
    extra_body={"reasoning_split": True}
)

choice = response.choices[0]

# 完整保留 response_message
messages.append(choice.message.model_dump())

# 追加工具结果
if choice.message.tool_calls:
    messages.append({
        "role": "tool",
        "tool_call_id": choice.message.tool_calls[0].id,
        "content": "旧金山当前天气：晴天，18°C"
    })

# 第二轮
response2 = client.chat.completions.create(
    model="MiniMax-M3",
    messages=messages,
    tools=[...],
    extra_body={"reasoning_split": True}
)
```

---

## OpenAI SDK: 原生格式

不启用 `reasoning_split` 时，thinking 嵌入在 `content` 的 `<think>...</think>` 标签中：

```python
response = client.chat.completions.create(
    model="MiniMax-M3",
    messages=[{"role": "user", "content": "9.11 和 9.9 哪个更大？"}],
    extra_body={"reasoning_split": False}
)

# content 格式: "<think>推理内容...</think>\n\n回答内容"
print(response.choices[0].message.content)
```

> **警告**：使用原生格式时，切勿修改 `content` 的内容，务必完整保留模型思考内容（`<think>reasoning_content</think>`）。

**强烈推荐使用 Interleaved Thinking 友好格式 (`reasoning_split=True`)。**

---

## 工具调用最佳实践

1. 始终将模型完整响应保留在对话历史中
2. 保持 thinking 链完整：不要截断或删除 thinking/reasoning 内容
3. `reasoning_split=True`（OpenAI SDK）让解析更容易
4. 独立工具调用可以并行执行，有依赖的工具调用应该顺序执行
