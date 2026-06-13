# MiniMax Prompt 缓存

> 来源: https://platform.minimaxi.com/docs/api-reference/text-prompt-caching

## 概述

MiniMax 提供**自动 prompt 缓存**机制，自动识别重复的上下文内容，无需更改接口调用方式即可降低延迟和成本。

## 特点

- **自动缓存**：被动式系统，自动识别重复上下文，无需像 Anthropic 那样显式设置 `cache_control`
- **成本降低**：缓存命中的输入 token 按折扣价计费
- **速度提升**：减少重复内容的处理时间

## 适用场景

- 系统提示词复用
- 固定工具定义
- 多轮对话历史

## 约束条件

- 缓存适用于 ≥512 输入 token 的 API 调用
- 使用前缀匹配，顺序为：工具定义 → 系统提示词 → 对话历史
- 任何内容变化都可能影响缓存

## 最佳实践

- 将静态/重复内容（工具、系统提示词、历史）放在对话开头
- 动态用户信息放在末尾
- 通过 `usage` 中的 token 计数监控缓存性能

---

## Anthropic SDK 示例

```python
import anthropic

client = anthropic.Anthropic(
    base_url="https://api.minimaxi.com/anthropic",
    api_key="<MINIMAX_API_KEY>",
)

# 第一次调用 - 创建缓存
response1 = client.messages.create(
    model="MiniMax-M3",
    max_tokens=200,
    system="[这里是《傲慢与偏见》的完整文本...]",
    messages=[{"role": "user", "content": "总结这本书的主题"}]
)
# usage: { input_tokens: 14813, cache_creation_input_tokens: 14813, ... }

# 第二次调用 - 缓存命中
response2 = client.messages.create(
    model="MiniMax-M3",
    max_tokens=200,
    system="[同样的《傲慢与偏见》完整文本...]",  # 相同的系统提示词
    messages=[{"role": "user", "content": "分析主人公的性格"}]
)
# usage: { input_tokens: 108, cache_read_input_tokens: 14813, ... }
```

## OpenAI SDK 示例

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://api.minimaxi.com/v1",
    api_key="<MINIMAX_API_KEY>",
)

response = client.chat.completions.create(
    model="MiniMax-M3",
    messages=[
        {"role": "system", "content": "[长文本内容...]"},
        {"role": "user", "content": "你的问题"}
    ],
    extra_body={"reasoning_split": True}
)

# 缓存 token 在 prompt_tokens_details.cached_tokens 中
print(response.usage.prompt_tokens_details.cached_tokens)
```

---

## 定价示例

以 MiniMax-M3（≤512k tokens）为例：
- 标准输入：¥4.20 / 1M tokens
- 标准输出：¥16.80 / 1M tokens
- 缓存命中：¥0.84 / 1M tokens

**场景**：50,000 总输入（45,000 缓存命中 + 5,000 新输入）+ 1,000 输出

- 无缓存：¥0.2268
- 有缓存：¥0.0756
- **节省约 66.7%**

---

## 缓存对比

| 特性 | 自动缓存（此页） | Anthropic 主动缓存 |
|------|-----------------|-------------------|
| 使用方式 | 自动检测 | API 中显式 `cache_control` |
| 计费 | 缓存命中 token 折扣；无额外写入费用 | 缓存命中 token 折扣；首次写入额外收费 |
| 过期 | 系统负载自适应调整 | 5 分钟过期，持续使用自动续期 |
| 支持模型 | MiniMax-M3, M2.7/M2.5/M2.1 系列 | M2.7/M2.5/M2.1/M2 系列 |
