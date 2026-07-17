# 缓存架构实现说明

## 总览

本次实现按四层缓存模型落地，不改变现有 API 请求/响应格式、NextAuth JWT 策略或 Prisma schema。

| 层 | 实现 | 失效策略 |
|---|---|---|
| Client State | TanStack Query | 30 秒 stale、5 分钟 GC、窗口聚焦刷新、mutation 精确失效 |
| Server Request | React `cache()` data layer | 仅单次 Server Component render/request 内去重 |
| Application | Redis + 内存降级 | 速率限制滑动窗口、导出缓存 1 小时 TTL、指标计数 |
| External API | DeepSeek/MiniMax 指标与实验骨架，Bailian Qwen 用量统计 | 实验默认关闭，环境变量启用后需重启 |

## Phase 1: TanStack Query

- `QueryProvider` 包裹 chat workspace，devtools 仅开发环境渲染。
- Query key 集中在 `src/lib/query-keys.ts`。
- 会话、项目、文件、成果和 API Key 均使用 typed query/mutation hooks。
- 删除项目/会话采用乐观移除并在失败时回滚。
- 聊天消息仍是当前页面的临时流式状态；发送流程由 `useMutation` 驱动，完成后失效会话缓存。

## Phase 2: Server Request Dedup

`src/lib/data/` 使用 React `cache()` 包裹带 `userId` 归属条件的 Prisma 查询。当前只做 request-scoped memoization；未启用 `unstable_cache`，因为部署目标未确定且认证数据需要完整的跨路由失效设计。

## Phase 3: Redis

- `src/lib/redis.ts` 使用惰性连接，避免模块导入时强制连接。
- 速率限制采用 Redis sorted set + Lua 原子滑动窗口。
- Redis 失败后短暂熔断并降级到有界内存窗口，API 仍可用。
- Artifact 导出 key 为 `export:{artifactId}:{format}:{sha256(content)}`，TTL 1 小时。
- 导出响应包含 `X-Cache: HIT` 或 `X-Cache: MISS`。

启动本地依赖：

```bash
docker compose up -d
```

环境变量：

```dotenv
REDIS_URL="redis://localhost:6379"
```

## Phase 4: 可观测性与实验开关

`GET /api/metrics/cache?days=7` 返回：

- 总体和每日 token 命中率
- DeepSeek/MiniMax/Bailian provider 对比
- Artifact Markdown/DOCX/PDF 导出命中率

Settings 使用 CSS 绘制轻量柱状条。实验代码默认关闭：

```dotenv
CACHE_EXPERIMENT_PROMPT_REORDER="false"
CACHE_EXPERIMENT_REORDER_STRATEGY="rag-to-last-user"
CACHE_EXPERIMENT_MINIMAX_ACTIVE="false"
```

修改变量后必须重启应用。建议至少收集一周基线再启用。

## Phase 5: 长消息列表

TanStack Virtual 对已完成消息做动态高度测量和 overscan；最后一条流式消息直接渲染，避免流式 Markdown 高度变化导致频繁重测。`MessageBubble` 使用 `React.memo`，内容变化仍会触发必要更新。

## 降级与权衡

- Redis 不可用：速率限制退回内存，导出直接生成，指标返回零值。
- 跨请求数据库缓存暂缓：避免用户数据短暂越权或写后读旧数据。
- NextAuth 保持 JWT：当前不需要 Redis session adapter。
- 虚拟化会触发 React Compiler 的 `incompatible-library` 提示；这是编译器跳过该组件优化的提示，不是运行时错误。
