# DeepSeek JSON 输出模式

## 启用方式

设置 `response_format` 参数：

```json
{
  "model": "deepseek-v4-pro",
  "messages": [...],
  "response_format": {"type": "json_object"}
}
```

## 提示词要求

系统或用户提示词中**必须**包含 `json` 字符串，并提供期望的 JSON 结构示例，以引导模型输出合法的 JSON。

## 示例 (Python)

```python
from openai import OpenAI

client = OpenAI(
    api_key="your-api-key",
    base_url="https://api.deepseek.com"
)

response = client.chat.completions.create(
    model="deepseek-v4-pro",
    messages=[
        {
            "role": "system",
            "content": 'Extract the question and answer in JSON format: {"question": "...", "answer": "..."}'
        },
        {
            "role": "user",
            "content": "What is the capital of France? Paris."
        }
    ],
    response_format={"type": "json_object"}
)

result = json.loads(response.choices[0].message.content)
print(result)  # {"question": "What is the capital of France?", "answer": "Paris."}
```

## 使用限制

1. **`max_tokens` 必须足够大** — 如果 token 限制太低，JSON 输出会在中途被截断，导致无效 JSON
2. **可能返回空内容** — API 偶尔会返回空的 content，建议通过调整提示词来缓解
3. **仅在特定模型上可用** — 需要 `deepseek-v4-pro` 或 `deepseek-v4-flash`

## 最佳实践

- 在系统提示词中提供明确的 JSON schema 示例
- 设置合适的 `max_tokens` 以确保完整输出
- 使用 `json.loads()` 解析前检查内容是否为空
- 考虑使用 `response_format` + `stream: false` 确保获得完整 JSON
