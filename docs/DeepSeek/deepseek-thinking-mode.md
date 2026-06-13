# DeepSeek 思考模式 (Thinking Mode)

## 概述

DeepSeek 模型在输出最终回答前，会先生成思维链（Chain of Thought），以提升答案的准确性和推理质量。思维链内容通过 `reasoning_content` 字段返回。

## 启用方式

```json
{
  "thinking": {"type": "enabled"}
}
```

关闭：
```json
{
  "thinking": {"type": "disabled"}
}
```

### OpenAI SDK (Python)

```python
response = client.chat.completions.create(
    model="deepseek-v4-pro",
    messages=[...],
    extra_body={"thinking": {"type": "enabled"}}
)
```

### OpenAI SDK (Node.js)

```javascript
const completion = await openai.chat.completions.create({
  model: "deepseek-v4-pro",
  messages: [...],
  thinking: {"type": "enabled"},
});
```

## 推理强度控制

| 参数 | API 格式 | 值 | 说明 |
|------|---------|-----|------|
| `reasoning_effort` | OpenAI | `"high"` `"max"` | 控制推理计算量 |
| `output_config.effort` | Anthropic | `"high"` `"max"` | Anthropic 格式 |

默认情况下，思考模式是启用的。普通请求默认 effort 为 `"high"`，复杂 Agent 类请求自动设为 `"max"`。

## 重要限制

- 思考模式下，以下参数**不生效**（设置也不会报错）：
  - `temperature`
  - `top_p`
  - `presence_penalty`
  - `frequency_penalty`

## 多轮对话拼接规则

### 无工具调用时

- 前轮 `reasoning_content` 无需参与上下文拼接
- 在后续轮次中将其传入 API 会被忽略
- 只需要传递 `role` 和 `content`

### 有工具调用时

- **必须完整回传** `reasoning_content` 给 API
- 否则会触发 **400 错误**
- 可直接用 `messages.append(response.choices[0].message)` 完成拼接

## 工具调用流程

1. 模型可进行多轮「思考 → 工具调用」循环
2. 直到 `tool_calls` 为 `None` 时终止
3. 每轮请求必须携带该轮次已产生的所有 `reasoning_content`
4. 跨对话轮次也需保留之前工具调用轮次产生的思维链内容

## 流式输出中读取

```python
for chunk in response:
    delta = chunk.choices[0].delta
    if hasattr(delta, 'reasoning_content') and delta.reasoning_content:
        print(f"Thinking: {delta.reasoning_content}")
    if delta.content:
        print(f"Answer: {delta.content}")
```
