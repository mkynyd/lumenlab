# DeepSeek FIM 补全 (Fill In the Middle)

## 概述

FIM 补全允许用户提供前缀（prefix）和可选后缀（suffix），模型填充中间部分。常用于代码补全和内容续写。

## 限制

- 最大补全长度: 4K tokens
- Beta 端点: `https://api.deepseek.com/beta`
- 仅非思考模式可用

## API 端点

使用 completions 端点（非 chat completions）：

```python
from openai import OpenAI

client = OpenAI(
    api_key="your-api-key",
    base_url="https://api.deepseek.com/beta"
)

response = client.completions.create(
    model="deepseek-v4-pro",
    prompt="def fibonacci(n):\n    # Calculate fibonacci number",
    suffix="\n    return result",
    max_tokens=256
)

print(response.choices[0].text)
```

### 参数说明

| 参数 | 说明 |
|------|------|
| `prompt` | 前缀文本（光标之前的内容） |
| `suffix` | 后缀文本（光标之后的内容） |
| `max_tokens` | 最大补全长度 |

## IDE 集成

支持通过 [Continue](https://continue.dev) VSCode 插件集成，配置指南参见 [awesome-deepseek-integration](https://github.com/deepseek-ai/awesome-deepseek-integration/blob/main/docs/continue/README_cn.md)。

## 对话前缀续写 (Chat Prefix Completion)

对话前缀续写是另一个 Beta 功能，允许在对话中提供模型已开始但未完成的回复前缀，让模型从此处继续生成。具体端点与参数请参考官方文档。
