# DeepSeek Token 用量计算

## 什么是 Token

Token 是 DeepSeek 模型处理自然语言的基本单位，同时也是计费单元。可以将 Token 理解为"字"或"词"：

- 1 个中文词语 ≈ 1 个 token
- 1 个英文单词 ≈ 1 个 token
- 1 个数字 ≈ 1 个 token
- 1 个符号 ≈ 1 个 token

## 字符与 Token 换算

由于不同模型的 tokenizer 不同，以下为近似值：

| 语言 | 换算比例 |
|------|---------|
| 英文 | 1 个英文字符 ≈ 0.3 个 token |
| 中文 | 1 个中文字符 ≈ 0.6 个 token |

> **重要**: 实际 token 数量以 API 返回的 `usage` 字段为准，用户无需自行估算。

## 离线计算 Token

DeepSeek 提供了 tokenizer 压缩包，允许在本地离线计算文本的 token 数量。可以从官方文档下载 `deepseek_v3_tokenizer.zip`。

## 计费方式

费用 = (输入 tokens + 输出 tokens) × 模型单价

每次 API 调用后，从返回结果的 `usage` 对象中查看实际消耗：

```json
{
  "usage": {
    "prompt_tokens": 500,
    "completion_tokens": 300,
    "total_tokens": 800,
    "prompt_cache_hit_tokens": 200,
    "prompt_cache_miss_tokens": 300
  }
}
```

- `prompt_tokens`: 输入消耗的 tokens
- `completion_tokens`: 输出消耗的 tokens
- `total_tokens`: 总消耗 = prompt_tokens + completion_tokens
- `prompt_cache_hit_tokens`: 缓存命中的 tokens（按缓存价格计费）
- `prompt_cache_miss_tokens`: 缓存未命中的 tokens（按标准价格计费）
