# Codex 协作提示词：缓存架构优化设计

## 背景

我们的应用 `course-ai-lab` 是一个基于 Next.js 16 (App Router) + PostgreSQL/pgvector 的 AI 课程助手平台，面向大学 CS 学生。当前应用已实现核心功能（聊天、项目管理、文件 OCR、RAG、Artifact 导出），但**缓存设计严重不足**——除了 DeepSeek/MiniMax API 层面的自动 KV Cache 外，应用层**零缓存**。

## 当前架构现状

### 技术栈
- **框架**: Next.js 16.2.9 (App Router, React 19, TypeScript 5)
- **数据库**: PostgreSQL 16 + pgvector (Docker)，Prisma 7.8.0 ORM
- **认证**: NextAuth.js v5 beta (JWT, Credentials)
- **AI SDK**: `@anthropic-ai/sdk` 0.104（单一 SDK 驱动 DeepSeek + MiniMax）
- **状态管理**: 无（全靠 `useState` + prop drilling）
- **数据获取**: 客户端 `fetch()` 在 `useEffect` 中直接调用，无任何缓存库
- **速率限制**: 内存 `Map` 实现，单进程有效
- **部署**: 当前开发阶段，目标生产环境待定

### 已有的“准缓存”设计
1. **DeepSeek KV Cache**（API 侧自动）：前缀匹配，系统提示词固定字符串放前面，动态 RAG 上下文放最后 user message 末尾提高命中率
2. **MiniMax Auto Prompt Cache**（API 侧自动）：图片解析场景，>=512 tokens 自动触发
3. **Prisma Client 单例**：`globalThis` 缓存在 dev 模式防止热重载创建过多连接
4. **流式 tee**：API 侧 SSE 流分叉——一路返回客户端，一路异步写 DB（fire-and-forget）

### 当前痛点
- 每次导航/挂载都重新请求数据（侧边栏会话列表、项目列表等重复刷新）
- 无请求去重（同一数据同时多次 fetch 产生重复 DB 查询）
- Artifact 导出每次重新生成文件（MD/DOCX/PDF），无产物缓存
- 速率限制内存存储，多进程/多实例场景失效
- 无 optimistic update，交互感知延迟明显
- 无消息列表虚拟化，长对话性能下降

---

## 优化目标：四层缓存架构

基于应用特点（单用户为主、写少读多、Dashboard 型交互），设计**四层缓存**：

```
┌──────────────────────────────────────────────────┐
│ Layer 1: Client State Cache (TanStack Query)     │
│ 会话列表、项目列表、文件列表、消息历史              │
│ stale-while-revalidate + optimistic update        │
├──────────────────────────────────────────────────┤
│ Layer 2: Server Request Dedup (React cache())     │
│ Server Component 中 DB 查询去重                    │
│ per-request memoization                          │
├──────────────────────────────────────────────────┤
│ Layer 3: Application Data Cache (Redis)           │
│ 速率限制、Session 存储、Artifact 产物缓存           │
│ 跨实例共享、持久化、TTL 管理                       │
├──────────────────────────────────────────────────┤
│ Layer 4: External API Cache (已有，增强观察)       │
│ DeepSeek KV Cache + MiniMax Prompt Cache          │
│ 增强命中率监控 + 自适应重排策略                     │
└──────────────────────────────────────────────────┘
```

---

## 请 Codex 实现的具体任务

### Phase 1: 客户端数据缓存层（优先级：高）

**目标**: 用 TanStack Query 替换所有客户端 `useEffect + fetch` 模式，消除重复请求、增加 SWR 缓存。

**具体步骤**:

1. **安装并配置 TanStack Query**
   ```bash
   npm install @tanstack/react-query @tanstack/react-query-devtools
   ```
   - 在 `src/app/(chat)/layout.tsx` 添加 `QueryClientProvider` 包裹
   - QueryClient 配置：
     - `staleTime: 30_000`（30 秒内视为新鲜，适合低频变更数据）
     - `gcTime: 5 * 60 * 1000`（5 分钟垃圾回收）
     - `refetchOnWindowFocus: true`（窗口聚焦时后台刷新）
     - `retry: 2`（失败重试 2 次）

2. **创建 Query Key 工厂** (`src/lib/query-keys.ts`)
   ```ts
   export const queryKeys = {
     conversations: {
       all: ['conversations'] as const,
       detail: (id: string) => ['conversations', id] as const,
     },
     projects: {
       all: ['projects'] as const,
       detail: (id: string) => ['projects', id] as const,
       files: (projectId: string) => ['projects', projectId, 'files'] as const,
       artifacts: (projectId: string) => ['projects', projectId, 'artifacts'] as const,
     },
     files: {
       detail: (id: string) => ['files', id] as const,
     },
     artifacts: {
       detail: (id: string) => ['artifacts', id] as const,
     },
     keys: ['api-keys'] as const,
   }
   ```

3. **创建自定义 Hooks 替换直接 fetch**
   - `useConversations()` — 替代 Sidebar 中的 fetch
   - `useConversation(id)` — 替代 conversation detail fetch
   - `useProjects()` — 替代项目列表 fetch
   - `useProject(id)` — 替代项目详情 fetch
   - `useProjectFiles(projectId)` — 替代文件列表 fetch
   - `useProjectArtifacts(projectId)` — 替代 artifact 列表 fetch
   - `useApiKeys()` — 替代 API key 列表 fetch

   每个 hook 使用 `useQuery` + 对应的 API route fetch。

4. **添加 Mutation Hooks**（带 optimistic update 和 cache invalidation）
   - `useCreateProject()` — 创建项目后 invalidate `projects.all`
   - `useDeleteProject()` — 删除后 invalidate + 从缓存移除
   - `useUploadFile(projectId)` — 上传后 invalidate `projects.files`
   - `useDeleteConversation()` — 删除后 invalidate `conversations.all`
   - `useSaveArtifact()` — 保存后 invalidate `projects.artifacts`
   - `useUpdateApiKeys()` — 保存后 invalidate `keys`

5. **改造的组件列表**（按优先级）:
   - `src/components/layout/sidebar.tsx` — 会话列表 + 项目列表
   - `src/components/project/project-sidebar.tsx` — 项目文件列表
   - `src/app/(chat)/projects/page.tsx` — 项目列表页
   - `src/app/(chat)/projects/[id]/page.tsx` — 项目详情页
   - `src/components/artifact/artifact-library.tsx` — Artifact 列表
   - `src/app/(chat)/settings/page.tsx` — API keys 设置

6. **为 chat messages 使用不同的缓存策略**
   - 消息列表不全局缓存（每次进入对话应拉取最新）
   - 但可以使用 `useQuery` 的 `placeholderData` 做即时展示优化
   - `sendMessage` 时使用 `useMutation` + 乐观更新消息列表

**注意事项**:
- 不要改动现有 API routes 的接口签名
- 保持组件的现有 UI 行为不变（loading/error/empty 状态）
- TanStack Query Devtools 仅在 `NODE_ENV === 'development'` 时渲染

---

### Phase 2: 服务端请求去重（优先级：中）

**目标**: 在 Server Components 中使用 React `cache()` 去重同一请求中的 DB 查询。

**具体步骤**:

1. **创建服务端数据访问层** (`src/lib/data/`)
   - `src/lib/data/conversations.ts` — `getConversation(id)`, `getConversations(userId)`
   - `src/lib/data/projects.ts` — `getProject(id)`, `getProjects(userId)`, `getProjectFiles(projectId)`
   - `src/lib/data/messages.ts` — `getMessages(conversationId)`
   - `src/lib/data/api-keys.ts` — `getApiKeys(userId)`

2. **用 React `cache()` 包裹每个查询函数**
   ```ts
   import { cache } from 'react'
   import { db } from '@/lib/db'
   
   export const getConversation = cache(async (id: string) => {
     return db.conversation.findUnique({
       where: { id },
       include: { messages: { orderBy: { createdAt: 'asc' } } },
     })
   })
   ```
   这样同一 HTTP 请求中多次调用 `getConversation(sameId)` 只执行一次 DB 查询。

3. **改造 Server Components 使用这些函数**
   - `src/app/(chat)/chat/[id]/page.tsx` — 使用 `getConversation(id)`
   - 未来新增的 Server Components 优先使用 data layer

4. **考虑跨请求缓存（可选，视部署环境）**
   - 如果部署在 Vercel，可用 `unstable_cache` 包裹数据查询
   - 设置合理的 `revalidate` 时间（如 10s）和 `tags`
   - 项目/文件更新时通过 `revalidateTag` 主动失效

---

### Phase 3: Redis 集成（优先级：中高）

**目标**: 用 Redis 替换内存速率限制，为 session 存储和产物缓存打基础。

**具体步骤**:

1. **安装 Redis 客户端**
   ```bash
   npm install ioredis
   npm install -D @types/ioredis
   ```

2. **创建 Redis 连接管理** (`src/lib/redis.ts`)
   ```ts
   import Redis from 'ioredis'
   
   const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'
   
   const globalForRedis = globalThis as unknown as { redis: Redis | undefined }
   
   export const redis = globalForRedis.redis ?? new Redis(REDIS_URL, {
     maxRetriesPerRequest: 3,
     retryStrategy(times) {
       return Math.min(times * 200, 2000)
     },
   })
   
   if (process.env.NODE_ENV !== 'production') {
     globalForRedis.redis = redis
   }
   ```

3. **升级速率限制器** (`src/lib/rate-limit.ts`)
   - 保留现有接口 `{ check(key, limit, windowMs): RateLimitResult }`
   - 内部实现改为 Redis sliding window 算法
   - Redis 不可用时 fallback 到内存实现（graceful degradation）
   - 添加 Redis 健康检查

   ```ts
   // Redis sliding window 实现思路：
   // 1. 每个请求使用 ZADD key score member (score = timestamp, member = unique id)
   // 2. ZREMRANGEBYSCORE key 0 (now - windowMs) 清理过期记录
   // 3. ZCARD key 获取当前窗口请求数
   // 4. EXPIRE key windowMs/1000 设置过期
   ```

4. **NextAuth Session 存储迁移到 Redis**（可选，为多实例部署做准备）
   - 当前 NextAuth 使用 JWT 策略（无状态），暂不需要
   - 如果未来改用 database session 策略，Redis 是最佳选择
   - 先预留配置项，不强制替换

5. **Artifact 导出结果缓存** (`src/lib/cache/export-cache.ts`)
   - 缓存 key: `export:{artifactId}:{format}:{contentHash}`
   - 缓存 value: Base64 编码的文件内容
   - TTL: 1 小时（导出文件通常下载后即弃）
   - 在 `src/app/api/artifacts/[id]/export/route.ts` 中集成
   - Cache hit 时添加 `X-Cache: HIT` 响应头便于调试

6. **Docker Compose 更新**
   - 在项目根目录的 docker-compose 中添加 Redis 服务
   ```yaml
   redis:
     image: redis:7-alpine
     ports:
       - "6379:6379"
     volumes:
       - redis_data:/data
     command: redis-server --appendonly yes
   ```

---

### Phase 4: API 缓存可观测性 + 实验配置开关（优先级：低-中）

**核心原则**：本轮**仅实现可观测性（指标采集 + 展示）和配置开关骨架**，不启用任何实验性策略。先跑一周收集基线数据，见到真实命中率后再决定是否打开开关。

---

#### Phase 4a: 缓存指标采集与聚合（本轮实现）

**目标**: 让缓存行为从“黑盒”变为可量化。

**1. 指标采集** (`src/lib/cache/api-cache-metrics.ts`)

Message 表已有 `cacheHitTokens` / `cacheMissTokens`，直接做聚合查询：

```ts
// 提供的查询函数
export async function getCacheMetrics(userId: string, days: number = 7) {
  // 按天聚合: SELECT DATE(createdAt) as date,
  //   SUM(cacheHitTokens) as totalHit,
  //   SUM(cacheMissTokens) as totalMiss
  // FROM Message WHERE userId = ? AND createdAt >= ?
  // GROUP BY DATE(createdAt) ORDER BY date DESC
}

export async function getCacheMetricsByProvider(userId: string) {
  // 按 provider 聚合（通过 Message -> Conversation 拿到 model 字段判断）
}

export async function getCacheMetricsByProject(userId: string, projectId: string) {
  // 按项目聚合：同一项目下所有消息的缓存汇总
}
```

- 返回结构: `{ date, totalHitTokens, totalMissTokens, hitRate, requestCount }`
- 命中率公式: `hitRate = totalHit / (totalHit + totalMiss)`（token 级别）
- 增加一个轻量 API route: `GET /api/metrics/cache?days=7`（需要 auth）

**2. Settings 页面展示** (`src/app/(chat)/settings/page.tsx`)

在 Settings 页面新增 "Cache" tab 或 section，展示：

- **概览卡片**: 近 7 天总体命中率（百分比 + 趋势箭头）
- **按天柱状图**: 每天 hit/miss tokens（用 CSS 实现简单 bar chart，不引入图表库）
- **按 Provider 对比**: DeepSeek vs MiniMax 命中率差异
- **Top 建议**: 如果命中率持续 < 80%，显示提示文字 "检测到缓存命中率偏低，可启用 Prompt 重排实验"

**3. 导出产物缓存命中率** (与 Phase 3 的 Artifact 导出缓存联动)

- 导出接口在 `X-Cache: HIT/MISS` 响应头之外，记录 `export:{format}:hit` / `export:{format}:miss` 计数器到 Redis
- Settings 页面同时展示导出缓存命中率

---

#### Phase 4b: 实验策略配置开关（本轮实现骨架，默认关闭）

**目标**: 为未来的策略实验准备好开关机制，但不启用任何实验。

**1. 配置模型** (`src/lib/cache/experiment-config.ts`)

```ts
// 所有实验性缓存策略的集中配置
// 使用环境变量控制，默认全部关闭

export const cacheExperiments = {
  // Phase 4b-1: 自适应 Prompt 重排
  adaptivePromptOrdering: {
    enabled: process.env.CACHE_EXPERIMENT_PROMPT_REORDER === 'true',
    // 命中率阈值：低于此值触发重排
    hitRateThreshold: 0.8,
    // 重排策略: 'rag-to-last-user' | 'frequent-context-to-system'
    strategy: (process.env.CACHE_EXPERIMENT_REORDER_STRATEGY || 'rag-to-last-user') as
      'rag-to-last-user' | 'frequent-context-to-system',
  },

  // Phase 4b-2: MiniMax Active Cache
  minimaxActiveCache: {
    enabled: process.env.CACHE_EXPERIMENT_MINIMAX_ACTIVE === 'true',
    // 最小 token 阈值（小于此值不启用 active cache，因为自动缓存已覆盖）
    minTokens: 512,
    // 缓存 TTL（MiniMax active cache 默认 5 分钟）
    ttlSeconds: 300,
  },
} as const

// 运行时检查：哪些实验已启用
export function getActiveExperiments(): string[] {
  return Object.entries(cacheExperiments)
    .filter(([_, config]) => config.enabled)
    .map(([key]) => key)
}
```

**2. Settings 页面实验开关 UI**

- 在 Settings 的 Cache section 底部添加 "实验性功能" 区域
- 每个实验一行：名称 + 描述 + 开关（Toggle 组件）+ 状态标签（"关闭" / "已启用"）
- 开关实际修改的是环境变量提示——点击时显示 "修改 `.env.local` 中的 `CACHE_EXPERIMENT_*` 变量并重启应用以启用"
- 原因：Next.js 中环境变量在构建时/请求时确定，运行时修改需要重启；避免误导用户以为开关即时生效

**3. 策略代码骨架**（逻辑就位但不执行）

即使开关关闭，也把代码路径写好——通过 `if (!cacheExperiments.xxx.enabled) return` 短路：

- `src/lib/cache/prompt-reorder.ts`:
  ```ts
  // 当 adaptivePromptOrdering 启用时
  // 在 chat API route 中，组装 messages 数组前调用
  export function reorderMessagesForCache(
    messages: Message[],
    systemPrompt: string,
    ragContext: string,
    config: typeof cacheExperiments.adaptivePromptOrdering
  ): Message[] {
    if (!config.enabled) return messages // 短路：默认不执行
    // ... 重排逻辑（本轮不执行，但代码已就位便于后续迭代）
  }
  ```

- `src/lib/cache/minimax-active-cache.ts`:
  ```ts
  // 当 minimaxActiveCache 启用时
  // 在 MiniMax API 调用的请求体中注入 cache_control
  export function applyActiveCache(
    requestBody: Record<string, unknown>,
    config: typeof cacheExperiments.minimaxActiveCache
  ): Record<string, unknown> {
    if (!config.enabled) return requestBody // 短路：默认不执行
    // ... 注入 ephemeral cache_control（本轮不执行，但代码已就位）
  }
  ```

**为什么本轮不启用实验策略**：
1. 没有基线数据——在不知道当前命中率的情况下，无法评估策略是否有效
2. MiniMax active cache 有 5 分钟 TTL 限制，课程助手低频使用场景下性价比存疑
3. Prompt 重排可能降低缓存命中率（如果重排逻辑有 bug），需要先在 dev 环境验证
4. 先跑一周 Phase 4a 的指标采集，见到真实数据后再决定是否打开开关

---

### Phase 5: 消息列表性能优化（优先级：中）

**目标**: 长对话场景下的渲染性能。

**具体步骤**:

1. **安装虚拟化库**
   ```bash
   npm install @tanstack/react-virtual
   ```

2. **改造 `ChatArea` / `MessageBubble`**
   - 使用 `useVirtualizer` 对消息列表虚拟化
   - 注意：消息高度不固定（Markdown 渲染），需要动态测量
   - 保留 `scrollIntoView` 行为（新消息自动滚到底部）
   - 在流式输出过程中，最后一条消息绕过虚拟化直接渲染

3. **React 渲染优化**
   - `MessageBubble` 用 `React.memo` 包裹，比较 `message.id` + `message.content`（流式更新时 content 变化是必要的重渲染）
   - 非流式消息比较 `message.id` 即可

---

## 实施顺序建议

```
Phase 1 (TanStack Query)        ← 最快见效，用户可感知的提升
    ↓
Phase 3 (Redis 速率限制)        ← 生产环境必要，同时为 4a 的导出缓存计数器提供 Redis 基础设施
    ↓
Phase 4a (缓存指标采集+展示)      ← 依赖 Phase 3 的 Redis，开始收集基线数据
    ↓
Phase 5 (消息虚拟化)            ← 改善长对话体验
    ↓
Phase 2 (Server cache())        ← 优化但非紧急
    ↓
Phase 4b (实验策略开关骨架)      ← 代码就位但不执行，等 4a 基线数据跑一周后再决定启用
```

**关键决策**：
- Phase 4a 放在 Phase 3 之后，因为导出缓存命中率需要 Redis 计数器
- Phase 4b 放最后——不依赖其他 Phase，且需要 4a 的基线数据作为启用依据
- Phase 4b 的策略代码虽然不执行，但写好并通过 `if (!enabled) return` 短路，后续改环境变量即可激活

---

## 核心约束

1. **API route 签名不变**：所有现有 API routes 的请求/响应格式保持兼容
2. **Auth 逻辑不变**：不改动 NextAuth 配置和 middleware
3. **数据库 schema 不变**：本次优化不新增数据库迁移
4. **向后兼容**：Redis 不可用时优雅降级（fallback 到内存/直接查询）
5. **类型安全**：所有新增代码使用 TypeScript，避免 `any`
6. **现有 UI 不变**：loading/error/empty 状态展示逻辑保持不变

---

## 期望交付物

1. 可运行的完整代码更改（所有修改的文件）
2. `IMPLEMENTATION.md` — 实现说明，包含每个 Phase 的关键决策和权衡
3. 如有必要的环境变量说明（如 `REDIS_URL`）
4. 更新后的 `docs/project-innovations.md`，新增缓存架构条目
