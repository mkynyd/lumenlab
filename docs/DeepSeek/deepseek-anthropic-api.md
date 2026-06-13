# DeepSeek Anthropic API 兼容格式

## 端点与认证

```
POST https://api.deepseek.com/anthropic
```

认证使用标准 `x-api-key` Header：

```
x-api-key: <your-deepseek-api-key>
```

`anthropic-beta` 和 `anthropic-version` Header 会被忽略。

## 模型映射

DeepSeek 自动将 Anthropic 模型名映射到自有模型：

| Anthropic 模型前缀 | DeepSeek 映射 |
|-------------------|--------------|
| `claude-opus-*` | `deepseek-v4-pro` |
| `claude-sonnet-*`、`claude-haiku-*` | `deepseek-v4-flash` |
| 未识别模型名 | `deepseek-v4-flash` |

## 支持的参数

### 完全支持

- `max_tokens`
- `stop_sequences`
- `stream`
- `system`
- `temperature` (0.0–2.0)
- `top_p`

### 部分支持

- `thinking`: `budget_tokens` 被忽略
- `output_config`: 仅支持 `effort`
- `metadata`: 仅支持 `user_id`

### 忽略的参数

- `top_k`
- `container`
- `mcp_servers`
- `service_tier`
- `cache_control`（所有相关字段）

## 工具支持

- 支持 `name`、`description`、`input_schema`
- `tool_choice` 支持 `none`、`auto`、`any`、`tool`
- `disable_parallel_tool_use` 被忽略

## 支持的消息内容类型

**支持**: text blocks、thinking blocks、tool_use、tool_result、server_tool_use、web_search_tool_result

**不支持**: image、document、search_result、redacted_thinking、code_execution_tool_result、MCP 相关类型

`citations` 和 `is_error` 子字段也被忽略。
