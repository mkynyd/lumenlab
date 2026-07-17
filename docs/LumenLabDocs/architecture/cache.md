# 缓存架构

> 面向开发者与自托管维护者，介绍 LumenLab 的四层缓存、速率限制与缓存指标。

## 四层缓存概览

LumenLab 使用四层缓存策略，从浏览器到外部 API 层层递进：

| 层级 | 实现位置 | 作用 |
|---|---|---|
| L1 客户端状态 | TanStack Query | 前端组件状态、服务端数据同步与乐观更新 |
| L2 服务端请求去重 | React `cache()` | 同一次 Next.js 服务端请求内，重复查询自动去重 |
| L3 应用级缓存 | Redis + 内存 fallback | 速率限制、导出缓存、实验配置、指标计数 |
| L4 外部 API 提示缓存 | DeepSeek prompt cache + MiniMax 实验骨架 | 利用模型侧提示缓存，降低 token 费用与延迟；Qwen 当前只记录用量，不启用应用侧 prompt-cache 实验 |

## Redis 接入

`src/lib/redis.ts` 使用 ioredis 创建连接：

- `lazyConnect: true`：首次使用时才建立连接。
- `connectTimeout: 2000` / `maxRetriesPerRequest: 1`：快速失败，避免阻塞业务。
- 全局单例：开发环境下通过 `globalThis` 复用同一连接。
- `checkRedisHealth()`：运行时健康检查。

Redis 不可用时，各消费者必须优雅降级；核心链路（聊天、导出）不能因缓存失效而中断。

## 速率限制

`src/lib/rate-limit.ts` 实现基于 Redis 的滑动窗口限流：

- Lua 脚本在 Redis 端原子完成：清理过期时间戳、计数、写入新成员、返回剩余配额。
- Redis 不可用时，自动降级到进程内 `Map` 实现的内存限流，并设置 30 秒 Redis 不可用冷却期，避免频繁重试。
- 内存存储上限 10,000 个 key，超限后按 LRU 清理 10%。

内置限流策略：

| 场景 | 上限 | 窗口 |
|---|---|---|
| LOGIN | 5 次 | 60 秒 |
| REGISTER | 3 次 | 60 秒 |
| CHAT | 30 次 | 60 秒 |
| API_KEY | 10 次 | 60 秒 |
| FILE_UPLOAD | 20 次 | 60 秒 |
| FILE_BATCH | 10 次 | 60 秒 |

## 导出缓存

`src/lib/cache/export-cache.ts` 缓存 Artifact 导出结果：

- 缓存键：`export:{artifactId}:{format}:{sha256(content)}`
- 支持格式：`markdown`、`docx`、`pdf`
- TTL：3600 秒
- 命中 / 未命中计数：`export:{format}:hit`、`export:{format}:miss`
- 内容以 base64 存入 Redis；Redis 不可用时直接重新生成，不阻塞下载。

## 实验开关

`src/lib/cache/experiment-config.ts` 提供可在运行时通过环境变量开启的缓存实验：

| 实验 | 环境变量 | 说明 |
|---|---|---|
| 自适应 Prompt 排序 | `CACHE_EXPERIMENT_PROMPT_REORDER=true` | 将 RAG 上下文移动到更利于命中模型 prompt cache 的位置 |
| MiniMax 主动缓存 | `CACHE_EXPERIMENT_MINIMAX_ACTIVE=true` | 对满足最小 token 数的 MiniMax 请求启用主动缓存，TTL 300 秒 |

具体策略：

- `rag-to-last-user`：把项目资料追加到最后一条 user 消息中。
- `frequent-context-to-system`：把高频上下文合并到 system prompt 中。

## 缓存指标

`src/app/api/metrics/cache/route.ts` 暴露 `GET /api/metrics/cache`，返回：

- 当前用户近 N 天的 prompt cache 命中 / 未命中 token 汇总（按 overall、daily、provider、project 聚合）。
- Token 使用量（按 DeepSeek / MiniMax / Bailian Qwen 拆分）。
- 导出缓存命中 / 未命中统计。

`days` 查询参数可指定 1–90 天，默认 7 天。

## 外部 API Prompt Cache

DeepSeek 支持 prompt cache。`AgentRuntime` 在构造 Provider 消息列表时：

- 保持 system prompt 与高频上下文稳定，提高缓存命中率。
- 通过实验开关 `reorderMessagesForCache()` 调整 RAG 上下文位置。
- 模型返回的 `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` 会写入 `Message.cacheHitTokens` / `cacheMissTokens`，供指标与成本分析使用。

## 相关文档

- 缓存命中数据如何进入数据库：见 [数据模型](./data-model.md)
- 请求流中何时触发缓存：见 [架构总览](./overview.md)
