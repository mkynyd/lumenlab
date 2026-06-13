# DeepSeek 工具调用 (Tool Calls)

## 函数定义格式

每个函数需要一个 `type`、`name`、`description` 和 `parameters`：

```json
{
  "type": "function",
  "function": {
    "name": "get_weather",
    "description": "Get the weather for a given location",
    "parameters": {
      "type": "object",
      "properties": {
        "location": {
          "type": "string",
          "description": "City name"
        }
      },
      "required": ["location"]
    }
  }
}
```

## 调用流程

1. **用户** 发送查询（如询问天气）
2. **模型** 返回函数调用 — 如 `get_weather({location: 'Hangzhou'})` — 而非自然语言
3. **用户/应用** 执行函数，将结果作为 `role: "tool"` 消息追加
4. **模型** 基于工具输出生成自然语言答案

> 注意：模型本身不执行具体函数，开发者需要提供实际的函数实现。

## 代码示例 (Python)

```python
tools = [{
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "Get weather for a location",
        "parameters": {
            "type": "object",
            "properties": {
                "location": {"type": "string"}
            },
            "required": ["location"]
        }
    }
}]

messages = [{"role": "user", "content": "What's the weather in Hangzhou?"}]

response = client.chat.completions.create(
    model="deepseek-v4-pro",
    messages=messages,
    tools=tools
)

msg = response.choices[0].message
if msg.tool_calls:
    for tool_call in msg.tool_calls:
        # Execute the function
        result = execute_function(tool_call.function.name, tool_call.function.arguments)
        messages.append(msg)
        messages.append({
            "role": "tool",
            "tool_call_id": tool_call.id,
            "content": str(result)
        })

    # Get final answer
    final_response = client.chat.completions.create(
        model="deepseek-v4-pro",
        messages=messages
    )
```

## 多轮工具调用

工具调用本质上是多轮的：收到函数调用后，将 assistant 消息（含 tool_calls）和工具响应都追加到 messages 数组，然后再次调用 API。

## 思考模式与工具调用

从 DeepSeek-V3.2 开始，API 支持在思考模式下进行工具调用，允许模型在决定调用工具前先进行推理。

## Strict 模式 (Beta)

端点：`https://api.deepseek.com/beta`

每个函数必须设 `"strict": true`，每个 object 必须包含 `"additionalProperties": false`，所有属性必须标记为 required。

### 支持的 JSON Schema 类型

`object`、`string`、`number`、`integer`、`boolean`、`array`、`enum`、`anyOf`

支持 `$ref`/`$def` 进行模块化 schema 定义。

### 限制

- `string` 类型支持 `pattern`（正则）和 `format`（email, hostname, ipv4, ipv6, uuid），但**不支持** `minLength`/`maxLength`
- `array` 类型**不支持** `minItems`/`maxItems`
