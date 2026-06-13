# DeepSeek 速率限制

## 并发限制

| 模型 | 并发请求上限 |
|------|-------------|
| `deepseek-v4-pro` | 500 |
| `deepseek-v4-flash` | 2,500 |

超出并发上限的请求将返回 **HTTP 429**。

可以通过提交扩容工单免费申请更高配额。

## user_id 隔离

`user_id` 参数（正则：`[a-zA-Z0-9\-_]+`，最长 512 字符）支持在单个账户内进行细粒度管理：

- **内容安全隔离** — 区分不同用户进行内容审核处理
- **KVCache 隔离** — 分离上下文缓存，保证隐私
- **调度隔离** — 标准账户中所有 user_id 共享并发池；已提升配额的账户中，每个 user_id 也有独立上限（v4-pro 500，v4-flash 2,500），未设置 user_id 视为独立 ID

## 设置 user_id

### OpenAI 格式
```json
{
  "model": "deepseek-v4-pro",
  "messages": [...],
  "user_id": "your_user_id"
}
```

使用 OpenAI SDK 时通过 `extra_body` 传入。

### Anthropic 格式
```json
{
  "metadata": {
    "user_id": "your_user_id"
  }
}
```

## Keep-Alive

- 非流式请求：服务端发送空白行作为 keep-alive
- 流式请求：服务端发送 SSE `: keep-alive` 注释
- 等待推理超时：10 分钟后连接关闭
