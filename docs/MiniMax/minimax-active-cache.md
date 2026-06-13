# MiniMax Anthropic 主动缓存

> 来源: https://platform.minimaxi.com/docs/api-reference/anthropic-api-compatible-cache

## 概述

MiniMax 支持 Anthropic API 兼容的 prompt 缓存（主动缓存），通过显式设置 `cache_control` 来管理缓存使用。

---

## 快速开始

`cache_control` 块在 Anthropic 兼容 API 中启用 prompt 缓存：

```python
import anthropic

client = anthropic.Anthropic(
    base_url="https://api.minimaxi.com/anthropic",
    api_key="<MINIMAX_API_KEY>",
)

response = client.messages.create(
    model="MiniMax-M2.7",
    max_tokens=500,
    system=[
        {
            "type": "text",
            "text": "[《傲慢与偏见》完整文本...]",
            "cache_control": {"type": "ephemeral"}
        }
    ],
    messages=[{"role": "user", "content": "总结这本书的主题"}]
)
```

两次连续调用的输出：
```json
// 第一次 - 创建缓存
{"cache_creation_input_tokens":188086, "cache_read_input_tokens":0,
 "input_tokens":21, "output_tokens":393}

// 第二次 - 缓存命中
{"cache_creation_input_tokens":0, "cache_read_input_tokens":188086,
 "input_tokens":21, "output_tokens":393}
```

---

## 缓存机制

发送带缓存的请求时，系统检查缓存断点之前的 prompt 前缀是否已存储：
- **已缓存**：直接使用缓存版本，减少处理时间和费用
- **未缓存**：完整处理 prompt 并在响应生成过程中缓存

缓存内容有 **5 分钟的生命周期**，每次命中自动刷新，无需额外费用。

---

## 缓存前缀构建

缓存前缀按以下顺序构建：`tools` → `system` → `messages`

每个层级基于前一层构建。

### 自动前缀检查

单个缓存断点放在静态内容末尾即可 —— 系统自动查找最长匹配前缀。

**三个核心原则**：

1. **累积缓存**：某块标记 `cache_control` 时，缓存内容从前面的所有块顺序生成
2. **正向顺序检查**：系统从每个显式断点向后检查，最大化匹配长度
3. **20 块回溯窗口**：每个显式断点最多检查前 20 个块。超出窗口无匹配则跳过该断点

---

## 可缓存内容

- **Tools**：`tools` 数组中的定义
- **System messages**：`system` 数组中的内容块
- **Text messages**：`messages.content` 中的用户和助手轮次
- **Tool use/results**：`tool_use` 和 `tool_result` 类型

任何上述内容标记 `cache_control` 即可启用缓存。

---

## 监控缓存性能

`usage` 对象提供以下字段：

| 字段 | 说明 |
|------|------|
| `cache_creation_input_tokens` | 创建新缓存时写入的 token 数 |
| `cache_read_input_tokens` | 从缓存读取的 token 数 |
| `input_tokens` | 未从缓存读取或未用于缓存创建的输入 token（断点之后的 token） |

总输入 token 计算：
```
total_input_tokens = cache_read + cache_creation + input_tokens
```

---

## 常见问题

缓存表现不符合预期时检查：

- **内容一致性**：缓存段必须在多次调用中完全相同
- **缓存过期**：调用必须在 5 分钟生命周期内
- **块数限制**：超过 20 个内容块时添加额外 `cache_control`
- **断点上限**：单次调用最多 4 个 `cache_control`，超过 4 个时仅最接近末尾的 4 个生效

---

## 定价

| 模型 | 输入 | 输出 | 缓存读取 | 缓存写入 |
|------|------|------|---------|---------|
| MiniMax-M2.7 | ¥2.10 | ¥8.40 | ¥0.42 | ¥2.625 |
| MiniMax-M2.7-highspeed | ¥2.10 | ¥16.80 | ¥0.42 | ¥2.625 |
| MiniMax-M2.5 | ¥2.10 | ¥8.40 | ¥0.21 | ¥2.625 |
| MiniMax-M2.5-highspeed | ¥2.10 | ¥16.80 | ¥0.21 | ¥2.625 |
| MiniMax-M2.1 | ¥2.10 | ¥8.40 | ¥0.21 | ¥2.625 |
| MiniMax-M2.1-highspeed | ¥2.10 | ¥16.80 | ¥0.21 | ¥2.625 |
| MiniMax-M2 | ¥2.10 | ¥8.40 | ¥0.21 | ¥2.625 |

---

## 更多示例

### 大上下文缓存

缓存 50 页法律协议全文。首次请求 `cache_creation_input_tokens` 包含所有系统消息 token，后续请求 `cache_read_input_tokens` 反映完整缓存。

### 缓存工具定义

将 `cache_control` 放在最后一个工具上，所有前面的工具定义作为一个前缀被缓存。

### 持续多轮对话

通过增量缓存：在每轮最后消息的最后一个块标记 `cache_control`，系统自动匹配最长缓存前缀。

### 多缓存断点

利用全部 4 个断点分别缓存 tools、system messages 和不同轮次的对话历史。适用于 RAG 应用、多工具 Agent 系统、长对话等场景。
