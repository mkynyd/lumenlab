# RAG 缓存层实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `course-ai-lab` 中为 RAG 流程新增三层缓存：`hybridSearch` 结果缓存、`selectFilesWithDeepSeek` 文件选择缓存、`embedQuery` 查询向量缓存；同时落地文件解析 `contentHash` 短路和多模态 embedding 降级重试。

**Architecture:** 采用 "Redis 精确缓存 + pgvector 语义缓存" 两层架构；通过 `version` 号实现项目级缓存失效，避免 `SCAN` + `DEL`；所有 key 按 `projectId` / `userId` 命名空间隔离；缓存逻辑抽离到独立 `src/lib/cache/rag-*-cache.ts` 模块，不污染原有 RAG 调用链。

**Tech Stack:** Next.js 16 App Router, TypeScript, Prisma 7, PostgreSQL + pgvector, Redis (ioredis), DashScope qwen3-vl-embedding, DeepSeek via Anthropic SDK.

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `src/lib/cache/rag-search-cache.ts` | `hybridSearch` 结果缓存：key 生成、读写、版本号递增、失效 |
| `src/lib/cache/rag-file-select-cache.ts` | `selectFilesWithDeepSeek` 缓存：key 生成、读写、INDEX 版本号递增 |
| `src/lib/cache/rag-query-embed-cache.ts` | `embedQuery` 缓存：精确缓存 + 可选语义缓存入口 |
| `src/lib/cache/api-cache-metrics.ts` | 扩展现有指标，新增 RAG 缓存命中率计数 |
| `src/lib/rag/vector-store.ts` | 修改 `hybridSearch`、`selectFilesWithDeepSeek`、`embedChunksForFile` |
| `src/lib/rag/embedding.ts` | 修改 `embedQuery` 注入缓存 |
| `src/lib/rag/project-index.ts` 等 | 文件变更处触发版本号递增 |
| `prisma/schema.prisma` | 新增 `QueryEmbeddingCache`、`SemanticResponseCache`（二期语义缓存必需） |
| `src/lib/cache/rag-cache.test.ts` | 新增单元测试 |

---

## Task 1：创建缓存公共模块与指标

**Files:**
- Create: `src/lib/cache/rag-cache-keys.ts`
- Modify: `src/lib/cache/api-cache-metrics.ts`

- [ ] **Step 1：新增 `src/lib/cache/rag-cache-keys.ts`**

```typescript
import { createHash } from "node:crypto";

export function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ").toLowerCase().slice(0, 400);
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function buildSearchCacheKey(
  projectId: string,
  version: string,
  query: string,
  fileScopeIds?: string[]
): string {
  const normalized = normalizeQuery(query);
  const scopePart = fileScopeIds && fileScopeIds.length > 0
    ? ":" + [...fileScopeIds].sort().join(",")
    : ":all";
  const hash = sha256(`${normalized}${scopePart}`);
  return `rag:search:v1:${projectId}:${version}:${hash}`;
}

export function buildFileSelectCacheKey(
  projectId: string,
  version: string,
  query: string
): string {
  const hash = sha256(normalizeQuery(query));
  return `rag:file-select:v1:${projectId}:${version}:${hash}`;
}

export function buildQueryEmbedCacheKey(query: string): string {
  const hash = sha256(normalizeQuery(query));
  return `rag:query-embed:v1:${hash}`;
}

export function buildSearchVersionKey(projectId: string): string {
  return `rag:search-version:${projectId}`;
}

export function buildIndexVersionKey(projectId: string): string {
  return `rag:index-version:${projectId}`;
}
```

- [ ] **Step 2：扩展 `src/lib/cache/api-cache-metrics.ts`**

在现有 export 基础上新增：

```typescript
export type RagCacheKind = "search" | "file-select" | "query-embed";

export async function recordRagCacheResult(
  kind: RagCacheKind,
  result: "hit" | "miss"
): Promise<void> {
  try {
    await getRedis().incr(`rag:${kind}:${result}`);
  } catch {
    // Metrics must never break retrieval.
  }
}
```

- [ ] **Step 3：验证类型无错**

Run: `cd /Users/yinjunhang/Documents/course-ai-lab/light-ai-chat && npx tsc --noEmit --pretty`
Expected: 无新增错误（现有错误应已存在）。

- [ ] **Step 4：Commit**

```bash
git add src/lib/cache/rag-cache-keys.ts src/lib/cache/api-cache-metrics.ts
git commit -m "feat(rag-cache): add cache key helpers and metrics counters"
```

---

## Task 2：实现 `hybridSearch` 结果缓存

**Files:**
- Create: `src/lib/cache/rag-search-cache.ts`
- Modify: `src/lib/rag/vector-store.ts`

- [ ] **Step 1：新增 `src/lib/cache/rag-search-cache.ts`**

```typescript
import { getRedis } from "@/lib/redis";
import {
  buildSearchCacheKey,
  buildSearchVersionKey,
} from "@/lib/cache/rag-cache-keys";
import { recordRagCacheResult } from "@/lib/cache/api-cache-metrics";
import type { KeywordChunkResult } from "@/lib/rag/vector-store";

const SEARCH_CACHE_TTL_SECONDS = 60;

export async function getSearchCache(
  projectId: string,
  query: string,
  fileScopeIds?: string[]
): Promise<KeywordChunkResult[] | null> {
  try {
    const version = (await getRedis().get(buildSearchVersionKey(projectId))) || "0";
    const key = buildSearchCacheKey(projectId, version, query, fileScopeIds);
    const cached = await getRedis().get(key);
    if (!cached) return null;
    const parsed = JSON.parse(cached) as KeywordChunkResult[];
    await recordRagCacheResult("search", "hit");
    return parsed;
  } catch {
    return null;
  }
}

export async function setSearchCache(
  projectId: string,
  query: string,
  fileScopeIds: string[] | undefined,
  result: KeywordChunkResult[]
): Promise<void> {
  try {
    const version = (await getRedis().get(buildSearchVersionKey(projectId))) || "0";
    const key = buildSearchCacheKey(projectId, version, query, fileScopeIds);
    await getRedis().setex(key, SEARCH_CACHE_TTL_SECONDS, JSON.stringify(result));
    await recordRagCacheResult("search", "miss");
  } catch {
    // Cache failures are non-fatal.
  }
}

export async function invalidateSearchCache(projectId: string): Promise<void> {
  try {
    await getRedis().incr(buildSearchVersionKey(projectId));
  } catch {
    // Ignore.
  }
}
```

- [ ] **Step 2：修改 `src/lib/rag/vector-store.ts` 的 `hybridSearch`**

在函数开头添加缓存读取，返回前添加缓存写入：

```typescript
export async function hybridSearch(params: { ... }): Promise<KeywordChunkResult[]> {
  const limit = params.limit ?? 10;

  // Try cache first
  const cached = await getSearchCache(
    params.projectId,
    params.query,
    params.fileAssetIds
  );
  if (cached) return cached;

  // existing logic ...
  const result = sortedIds.flatMap(...);

  await setSearchCache(params.projectId, params.query, params.fileAssetIds, result);
  return result;
}
```

需要引入：

```typescript
import { getSearchCache, setSearchCache } from "@/lib/cache/rag-search-cache";
```

- [ ] **Step 3：在文件变更处触发失效**

在 `createDocumentChunks` 最后、文件删除逻辑、重新解析入口调用 `invalidateSearchCache(projectId)`。

具体修改 `createDocumentChunks`：

```typescript
export async function createDocumentChunks(params: CreateChunksParams): Promise<number> {
  // ... existing logic ...
  await prisma.documentChunk.createMany({ data });
  if (params.projectId) {
    await invalidateSearchCache(params.projectId);
  }
  return texts.length;
}
```

文件删除：在 `FileAsset` 删除的 Server Action / API 中调用 `invalidateSearchCache(projectId)`。如果暂时没有统一入口，可在 `createDocumentChunks` 的 `deleteMany` 触发，因为删除通常伴随重新解析。若单独删除文件，需要找到对应调用点补充。

- [ ] **Step 4：运行测试**

Run: `cd /Users/yinjunhang/Documents/course-ai-lab/light-ai-chat && npm test -- src/lib/cache`
Expected: 通过或没有相关失败。

- [ ] **Step 5：Commit**

```bash
git add src/lib/cache/rag-search-cache.ts src/lib/rag/vector-store.ts
git commit -m "feat(rag-cache): add hybridSearch result cache with version invalidation"
```

---

## Task 3：实现 `selectFilesWithDeepSeek` 缓存

**Files:**
- Create: `src/lib/cache/rag-file-select-cache.ts`
- Modify: `src/lib/rag/vector-store.ts`
- Modify: `src/lib/rag/project-index.ts`

- [ ] **Step 1：新增 `src/lib/cache/rag-file-select-cache.ts`**

```typescript
import { getRedis } from "@/lib/redis";
import {
  buildFileSelectCacheKey,
  buildIndexVersionKey,
} from "@/lib/cache/rag-cache-keys";
import { recordRagCacheResult } from "@/lib/cache/api-cache-metrics";

const FILE_SELECT_CACHE_TTL_SECONDS = 600;

export interface FileSelectionResult {
  fileIds: string[];
  source: "agentic-retrieval" | "index-fallback";
}

export async function getFileSelectCache(
  projectId: string,
  query: string
): Promise<FileSelectionResult | null> {
  try {
    const version = (await getRedis().get(buildIndexVersionKey(projectId))) || "0";
    const key = buildFileSelectCacheKey(projectId, version, query);
    const cached = await getRedis().get(key);
    if (!cached) return null;
    const parsed = JSON.parse(cached) as FileSelectionResult;
    await recordRagCacheResult("file-select", "hit");
    return parsed;
  } catch {
    return null;
  }
}

export async function setFileSelectCache(
  projectId: string,
  query: string,
  result: FileSelectionResult
): Promise<void> {
  try {
    const version = (await getRedis().get(buildIndexVersionKey(projectId))) || "0";
    const key = buildFileSelectCacheKey(projectId, version, query);
    await getRedis().setex(key, FILE_SELECT_CACHE_TTL_SECONDS, JSON.stringify(result));
    await recordRagCacheResult("file-select", "miss");
  } catch {
    // Ignore.
  }
}

export async function invalidateFileSelectCache(projectId: string): Promise<void> {
  try {
    await getRedis().incr(buildIndexVersionKey(projectId));
  } catch {
    // Ignore.
  }
}
```

- [ ] **Step 2：修改 `selectFilesWithDeepSeek`**

在函数开头尝试缓存，DeepSeek 返回后写入缓存：

```typescript
export async function selectFilesWithDeepSeek(params: { ... }) {
  const limit = params.limit ?? 12;

  const cached = await getFileSelectCache(params.projectId, params.query);
  if (cached) return cached;

  // ... existing logic ...
  if (fileIds.length === 0) {
    const fallback = await fallback();
    await setFileSelectCache(params.projectId, params.query, fallback);
    return fallback;
  }

  const result = { fileIds, source: "agentic-retrieval" as const };
  await setFileSelectCache(params.projectId, params.query, result);
  return result;
}
```

- [ ] **Step 3：在 INDEX 更新处触发失效**

修改 `src/lib/rag/project-index.ts` 的 `refreshProjectIndex`，在写入 `ProjectIndex` 后调用 `invalidateFileSelectCache(projectId)`。

- [ ] **Step 4：运行测试**

Run: `npm test -- src/lib/cache`
Expected: 通过。

- [ ] **Step 5：Commit**

```bash
git add src/lib/cache/rag-file-select-cache.ts src/lib/rag/vector-store.ts src/lib/rag/project-index.ts
git commit -m "feat(rag-cache): add selectFilesWithDeepSeek cache with index version invalidation"
```

---

## Task 4：实现 `embedQuery` 缓存

**Files:**
- Create: `src/lib/cache/rag-query-embed-cache.ts`
- Modify: `src/lib/rag/embedding.ts`

- [ ] **Step 1：新增 `src/lib/cache/rag-query-embed-cache.ts`**

```typescript
import { getRedis } from "@/lib/redis";
import { buildQueryEmbedCacheKey } from "@/lib/cache/rag-cache-keys";
import { recordRagCacheResult } from "@/lib/cache/api-cache-metrics";

const QUERY_EMBED_TTL_SECONDS = 300;

export async function getQueryEmbeddingCache(query: string): Promise<number[] | null> {
  try {
    const key = buildQueryEmbedCacheKey(query);
    const cached = await getRedis().get(key);
    if (!cached) return null;
    const parsed = JSON.parse(cached) as number[];
    await recordRagCacheResult("query-embed", "hit");
    return parsed;
  } catch {
    return null;
  }
}

export async function setQueryEmbeddingCache(
  query: string,
  embedding: number[]
): Promise<void> {
  try {
    const key = buildQueryEmbedCacheKey(query);
    await getRedis().setex(key, QUERY_EMBED_TTL_SECONDS, JSON.stringify(embedding));
    await recordRagCacheResult("query-embed", "miss");
  } catch {
    // Ignore.
  }
}
```

- [ ] **Step 2：修改 `embedQuery`**

```typescript
export async function embedQuery(query: string, apiKey: string): Promise<number[]> {
  const cached = await getQueryEmbeddingCache(query);
  if (cached) return cached;

  const embeddings = await embedTexts([query], apiKey);
  const result = embeddings[0];
  await setQueryEmbeddingCache(query, result);
  return result;
}
```

- [ ] **Step 3：运行测试**

Run: `npm test -- src/lib/cache`
Expected: 通过。

- [ ] **Step 4：Commit**

```bash
git add src/lib/cache/rag-query-embed-cache.ts src/lib/rag/embedding.ts
git commit -m "feat(rag-cache): add embedQuery exact cache"
```

---

## Task 5：文件解析 `contentHash` 短路 + 多模态降级重试

**Files:**
- Modify: `src/lib/rag/vector-store.ts`
- Modify: `src/lib/rag/embedding.ts`

- [ ] **Step 1：在 `embedding.ts` 新增 `embedChunkWithFallback`**

```typescript
export async function embedChunkWithFallback(options: {
  chunk: { id: string; content: string; mediaUrls: string[] };
  apiKey: string;
}): Promise<number[]> {
  const { chunk, apiKey } = options;
  const api = getApi(apiKey);

  const mediaUrls = (chunk.mediaUrls ?? []).slice(0, MAX_MEDIA_PER_FUSION);
  const multimediaInput: { text?: string; image?: string; video?: string }[] = [
    { text: chunk.content },
  ];
  for (const url of mediaUrls) {
    if (/\.(mp4|mov|avi|webm|mkv|flv|mpeg|mpg)(\?.*)?$/i.test(url)) {
      multimediaInput.push({ video: url });
    } else {
      multimediaInput.push({ image: url });
    }
  }

  try {
    const embeddings = await callMultiModalEmbedding(api, multimediaInput, {
      enableFusion: true,
      expectCount: 1,
      context: `chunk ${chunk.id}`,
    });
    return embeddings[0];
  } catch (error) {
    // Fallback to text-only embedding
    const embeddings = await callMultiModalEmbedding(api, [{ text: chunk.content }], {
      enableFusion: false,
      expectCount: 1,
      context: `chunk ${chunk.id} text fallback`,
    });
    return embeddings[0];
  }
}
```

- [ ] **Step 2：修改 `embedChunksForFile` 使用 fallback 并添加 contentHash 短路**

```typescript
export async function embedChunksForFile(options: {
  fileAssetId: string;
  apiKey: string;
}): Promise<void> {
  const fileAsset = await prisma.fileAsset.findUnique({
    where: { id: options.fileAssetId },
    select: { textContent: true },
  });
  if (!fileAsset?.textContent) return;

  const newHash = crypto
    .createHash("sha256")
    .update(fileAsset.textContent)
    .digest("hex")
    .slice(0, 32);

  const existingChunks = await prisma.documentChunk.findMany({
    where: { fileAssetId: options.fileAssetId },
    select: { id: true, contentHash: true, embedding: true },
  });

  if (
    existingChunks.length > 0 &&
    existingChunks.every((c) => c.contentHash === newHash && c.embedding !== null)
  ) {
    return; // Content unchanged and already embedded
  }

  const chunks = await prisma.documentChunk.findMany({
    where: { fileAssetId: options.fileAssetId },
    select: { id: true, content: true, mediaUrls: true },
    orderBy: { chunkIndex: "asc" },
  });
  if (chunks.length === 0) return;

  for (let i = 0; i < chunks.length; i += CHUNK_EMBED_CONCURRENCY) {
    const batch = chunks.slice(i, i + CHUNK_EMBED_CONCURRENCY);
    await Promise.all(
      batch.map(async (chunk) => {
        try {
          const embedding = await embedChunkWithFallback({ chunk, apiKey: options.apiKey });
          const vector = `[${embedding.join(",")}]`;
          await prisma.$executeRawUnsafe(
            `UPDATE "DocumentChunk" SET embedding = $1::vector WHERE id = $2`,
            vector,
            chunk.id
          );
        } catch (error) {
          // Log but do not fail the whole file; leave embedding null for this chunk
          console.error(`Failed to embed chunk ${chunk.id}:`, error);
        }
      })
    );
  }
}
```

- [ ] **Step 3：运行测试**

Run: `npm test`
Expected: 通过。

- [ ] **Step 4：Commit**

```bash
git add src/lib/rag/embedding.ts src/lib/rag/vector-store.ts
git commit -m "feat(rag-cache): contentHash short-circuit and multimodal embedding fallback"
```

---

## Task 6：Prisma Schema 更新（为二期语义缓存准备）

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1：新增两个模型**

```prisma
model QueryEmbeddingCache {
  id         String   @id @default(cuid())
  userId     String
  namespace  String
  promptHash String
  promptText String
  embedding  Unsupported("vector(1024)")
  createdAt  DateTime @default(now())
  expiresAt  DateTime

  @@unique([namespace, promptHash])
  @@index([userId])
  @@index([namespace])
  @@index([expiresAt])
}

model SemanticResponseCache {
  id           String   @id @default(cuid())
  userId       String
  namespace    String
  promptHash   String
  responseType String
  responseJson String
  embedding    Unsupported("vector(1024)")
  createdAt    DateTime @default(now())
  expiresAt    DateTime

  @@index([userId])
  @@index([namespace])
  @@index([responseType])
  @@index([expiresAt])
}
```

- [ ] **Step 2：生成迁移**

Run: `npx prisma migrate dev --name add_rag_semantic_cache`
Expected: 迁移成功。

- [ ] **Step 3：Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(rag-cache): add semantic cache schema for future embedding/response caching"
```

---

## Task 7：Settings 页面展示 RAG 缓存指标

**Files:**
- Modify: 现有 Settings 指标组件（找到对应文件）

- [ ] **Step 1：找到 Settings 页面中缓存指标的展示位置**

通常是 `src/app/(main)/settings/page.tsx` 或类似文件，参考 `useCacheMetrics` hook。

- [ ] **Step 2：扩展指标读取**

在 API `/api/metrics/cache` 或对应 hook 中读取新增 Redis key：

```typescript
const [searchHit, searchMiss, fileSelectHit, fileSelectMiss, queryEmbedHit, queryEmbedMiss] =
  await Promise.all([
    redis.get("rag:search:hit"),
    redis.get("rag:search:miss"),
    redis.get("rag:file-select:hit"),
    redis.get("rag:file-select:miss"),
    redis.get("rag:query-embed:hit"),
    redis.get("rag:query-embed:miss"),
  ]);
```

- [ ] **Step 3：在 UI 增加三行展示**

复用现有柱状条组件，展示 `hybridSearch` 命中率、`selectFilesWithDeepSeek` 命中率、`embedQuery` 命中率。

- [ ] **Step 4：Commit**

```bash
git add src/app/(main)/settings/page.tsx src/lib/cache/api-cache-metrics.ts
git commit -m "feat(rag-cache): expose RAG cache hit rates in settings"
```

---

## Task 8：新增单元测试

**Files:**
- Create: `src/lib/cache/rag-cache.test.ts`

- [ ] **Step 1：测试 key 生成和缓存读写**

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  buildSearchCacheKey,
  buildFileSelectCacheKey,
  buildQueryEmbedCacheKey,
  normalizeQuery,
} from "@/lib/cache/rag-cache-keys";

vi.mock("@/lib/redis", () => ({
  getRedis: () => ({
    get: vi.fn(),
    setex: vi.fn(),
    incr: vi.fn(),
  }),
}));

describe("rag cache keys", () => {
  it("normalizes query consistently", () => {
    expect(normalizeQuery("  Hello   World  ")).toBe("hello world");
  });

  it("builds search cache key with version and scope", () => {
    const key = buildSearchCacheKey("proj_1", "3", "test query", ["file_a", "file_b"]);
    expect(key).toMatch(/^rag:search:v1:proj_1:3:[a-f0-9]{64}$/);
  });

  it("sorts fileScopeIds for stable key", () => {
    const key1 = buildSearchCacheKey("proj_1", "3", "test", ["b", "a"]);
    const key2 = buildSearchCacheKey("proj_1", "3", "test", ["a", "b"]);
    expect(key1).toBe(key2);
  });

  it("builds file select key", () => {
    const key = buildFileSelectCacheKey("proj_1", "2", "query");
    expect(key).toMatch(/^rag:file-select:v1:proj_1:2:[a-f0-9]{64}$/);
  });

  it("builds query embed key", () => {
    const key = buildQueryEmbedCacheKey("query");
    expect(key).toMatch(/^rag:query-embed:v1:[a-f0-9]{64}$/);
  });
});
```

- [ ] **Step 2：运行测试**

Run: `npm test -- src/lib/cache/rag-cache.test.ts`
Expected: PASS。

- [ ] **Step 3：Commit**

```bash
git add src/lib/cache/rag-cache.test.ts
git commit -m "test(rag-cache): add cache key tests"
```

---

## Task 9：最终验证与 Lint

- [ ] **Step 1：运行全量测试**

Run: `npm test`
Expected: 全部通过。

- [ ] **Step 2：运行 Lint**

Run: `npm run lint`
Expected: 无新增错误。

- [ ] **Step 3：构建检查**

Run: `npm run build`
Expected: 构建成功。

- [ ] **Step 4：最终 Commit 或检查 git 状态**

```bash
git status
```

Expected: 所有修改已提交。

---

## 自我检查

- **Spec 覆盖检查：**
  - `hybridSearch` 结果缓存：Task 2 完成。
  - `selectFilesWithDeepSeek` 缓存：Task 3 完成。
  - `embedQuery` 缓存：Task 4 完成。
  - `contentHash` 短路：Task 5 完成。
  - 多模态降级重试：Task 5 完成。
  - 可观测性：Task 7 完成。

- **Placeholder 扫描：** 无 TBD、TODO、implement later。

- **类型一致性：** 所有 key 生成函数、缓存读写函数的类型在 Task 1-4 中保持一致；`KeywordChunkResult` 类型直接复用 `vector-store.ts` 的导出。
