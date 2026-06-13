# DeepSeek API 概述

## Base URL

| 格式 | URL |
|------|-----|
| OpenAI 兼容格式 | `https://api.deepseek.com` |
| Anthropic 兼容格式 | `https://api.deepseek.com/anthropic` |

## 认证

API Key 通过 HTTP Header 传递：

```
Authorization: Bearer ${DEEPSEEK_API_KEY}
```

API Key 在 [DeepSeek Platform](https://platform.deepseek.com/api_keys) 创建和管理。

## 主要端点

### Chat Completions

```
POST https://api.deepseek.com/chat/completions
Content-Type: application/json
Authorization: Bearer <your-api-key>
```

## 可用模型

| 模型名 | 上下文长度 | 最大输出 | 说明 |
|-------|-----------|----------|------|
| `deepseek-v4-pro` | 1M tokens | 384K tokens | 旗舰模型，支持思考模式 |
| `deepseek-v4-flash` | 1M tokens | 384K tokens | 快速模型，支持思考模式 |

### 已弃用模型别名（2026-07-24 后弃用）

- `deepseek-chat` → 映射到 `deepseek-v4-flash`（非思考模式）
- `deepseek-reasoner` → 映射到 `deepseek-v4-flash`（思考模式）

## 核心参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `model` | string | 模型名称 |
| `messages` | array | 消息列表 `[{role, content}]` |
| `stream` | boolean | 是否启用流式输出 |
| `thinking` | object | `{type: "enabled" \| "disabled"}` |
| `reasoning_effort` | string | 推理强度：`"high"` 或 `"max"` |
| `max_tokens` | integer | 最大输出 token 数 |
| `temperature` | float | 采样温度（思考模式下不生效） |
| `user_id` | string | 用户标识，用于隔离和速率限制 |

## 费用说明

费用从 DeepSeek 账户余额中扣除。赠送余额优先于充值余额消耗。

## 联系

- 邮箱: api-service@deepseek.com
- 许可证: MIT
