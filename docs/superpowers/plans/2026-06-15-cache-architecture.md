# Cache Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add client query caching, Redis-backed shared caching, cache observability, long-chat virtualization, request-scoped server query deduplication, and disabled experiment scaffolding without changing existing API contracts, auth behavior, or database schema.

**Architecture:** TanStack Query owns reusable browser data and mutations, while the existing streaming chat hook keeps transient message state and uses a mutation only for the send lifecycle. React `cache()` wraps authenticated Prisma reads used by Server Components. Redis provides optional shared rate limits, export payload caching, and counters, with bounded in-memory fallbacks when Redis is unavailable.

**Tech Stack:** Next.js 16.2 App Router, React 19, TypeScript 5, TanStack Query, TanStack Virtual, Prisma 7, PostgreSQL/pgvector, ioredis, Vitest, Testing Library.

---

### Task 1: Dependencies, Query Provider, Keys, and Typed Fetching

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/components/providers/query-provider.tsx`
- Modify: `src/app/(chat)/layout.tsx`
- Create: `src/lib/query-keys.ts`
- Create: `src/lib/api/client.ts`
- Test: `src/lib/query-keys.test.ts`
- Test: `src/lib/api/client.test.ts`

- [ ] Write failing tests for stable query keys and non-2xx API error parsing.
- [ ] Run `npm test -- src/lib/query-keys.test.ts src/lib/api/client.test.ts` and confirm failures are caused by missing modules.
- [ ] Install `@tanstack/react-query`, `@tanstack/react-query-devtools`, `@tanstack/react-virtual`, and `ioredis`.
- [ ] Implement a client-only `QueryProvider` with `staleTime: 30_000`, `gcTime: 300_000`, `refetchOnWindowFocus: true`, and `retry: 2`; render devtools only in development.
- [ ] Add the exact query-key factory from the approved prompt and a typed `fetchJson` helper that preserves route payloads and surfaces route errors.
- [ ] Wrap the chat layout inside `SessionProvider` and `QueryProvider` without changing the existing sidebar behavior.
- [ ] Re-run focused tests and `npx tsc --noEmit`.

### Task 2: Query and Mutation Hooks

**Files:**
- Create: `src/lib/hooks/use-conversations.ts`
- Create: `src/lib/hooks/use-projects.ts`
- Create: `src/lib/hooks/use-project-files.ts`
- Create: `src/lib/hooks/use-artifacts.ts`
- Create: `src/lib/hooks/use-api-keys.ts`
- Create: `src/lib/api/types.ts`
- Test: `src/lib/hooks/query-hooks.test.tsx`

- [ ] Write failing hook tests for request deduplication, project deletion rollback, conversation deletion rollback, and invalidation after uploads/artifact saves/API key updates.
- [ ] Run the focused test and verify the missing hooks fail.
- [ ] Implement typed query hooks for conversations, conversation detail, projects, project detail, project files, project artifacts, artifact detail, and API keys.
- [ ] Implement project create/delete, file upload, conversation delete, artifact save/delete, and API-key update/delete mutations.
- [ ] Use optimistic cache removal only where rollback data is complete; invalidate affected list/detail keys after settlement.
- [ ] Re-run focused tests.

### Task 3: Migrate Client Fetching Without UI Changes

**Files:**
- Modify: `src/components/layout/sidebar.tsx`
- Modify: `src/app/(chat)/projects/page.tsx`
- Modify: `src/app/(chat)/projects/new/page.tsx`
- Modify: `src/app/(chat)/projects/[id]/page.tsx`
- Modify: `src/components/project/project-sidebar.tsx`
- Modify: `src/components/project/file-upload.tsx`
- Modify: `src/components/artifact/artifact-library.tsx`
- Modify: `src/app/(chat)/settings/page.tsx`
- Test: `src/components/layout/sidebar.test.tsx`
- Test: `src/components/artifact/artifact-library.test.tsx`

- [ ] Add failing component tests proving cached navigation data renders and optimistic deletion preserves existing loading/empty behavior.
- [ ] Replace fetch-on-mount state in the named components with query hooks while retaining current markup and status states.
- [ ] Route file uploads and artifact/API-key mutations through mutation hooks.
- [ ] Keep file parse/enhance and file-content editing as direct mutations, then invalidate project/file detail keys.
- [ ] Remove `refreshKey` data-fetch coupling from the artifact library while preserving its open/close animation.
- [ ] Re-run component tests and lint the modified files.

### Task 4: Chat Query Placeholder and Send Mutation

**Files:**
- Modify: `src/lib/hooks/use-chat.ts`
- Modify: `src/components/chat/chat-area.tsx`
- Modify: `src/app/(chat)/projects/[id]/page.tsx`
- Test: `src/lib/hooks/use-chat.test.tsx`

- [ ] Write failing tests showing conversation switching uses cached placeholder messages but still refetches, and send failure removes only optimistic streaming state.
- [ ] Add an optional conversation query with `staleTime: 0`, `refetchOnMount: "always"`, and `placeholderData` sourced from the detail cache.
- [ ] Wrap the existing SSE send lifecycle in `useMutation` without changing `/api/chat` payload or stream parsing.
- [ ] Keep streamed messages local to the active chat; update conversation and navigation query caches after a completed send.
- [ ] Re-run chat tests.

### Task 5: Redis Connection, Sliding-Window Rate Limiting, and Health

**Files:**
- Create: `src/lib/redis.ts`
- Modify: `src/lib/rate-limit.ts`
- Create: `src/lib/rate-limit.test.ts`
- Modify: `src/app/api/chat/route.ts`
- Modify: `src/app/api/keys/route.ts`
- Modify: `src/app/api/auth/register/route.ts`
- Modify: `src/lib/auth.ts`
- Modify: `.env.example`
- Modify: `docker-compose.yml`

- [ ] Write failing tests for Redis sliding-window results, unique sorted-set members, TTL, and memory fallback.
- [ ] Implement lazy Redis connection management with error handling that does not emit unhandled connection errors when Redis is absent.
- [ ] Convert `checkRateLimit` to async while preserving its arguments and result shape; use one Lua script or transaction so cleanup, insert, count, and expiry are atomic.
- [ ] Bound the fallback memory map and preserve existing endpoint limits.
- [ ] Update all call sites to await the limiter and expose a Redis health-check function for internal diagnostics.
- [ ] Add `REDIS_URL`, Redis compose service, persistent volume, and dependency health ordering without changing JWT sessions.
- [ ] Re-run rate-limit and route tests.

### Task 6: Artifact Export Cache and Counters

**Files:**
- Create: `src/lib/cache/export-cache.ts`
- Create: `src/lib/cache/export-cache.test.ts`
- Modify: `src/app/api/artifacts/[id]/export/route.ts`
- Test: `src/app/api/artifacts/[id]/export/route.test.ts`

- [ ] Write failing tests for deterministic content hashes, Redis hit/miss behavior, direct-generation fallback, one-hour TTL, and `X-Cache`.
- [ ] Implement `export:{artifactId}:{format}:{contentHash}` values as base64 with safe Redis failure handling.
- [ ] Cache all formats, including Markdown, and return `X-Cache: HIT` or `MISS`.
- [ ] Increment `export:{format}:hit` and `export:{format}:miss` counters best-effort without failing downloads.
- [ ] Re-run focused tests.

### Task 7: Cache Metrics API and Settings Visualization

**Files:**
- Create: `src/lib/cache/api-cache-metrics.ts`
- Create: `src/lib/cache/api-cache-metrics.test.ts`
- Create: `src/app/api/metrics/cache/route.ts`
- Create: `src/app/api/metrics/cache/route.test.ts`
- Create: `src/lib/hooks/use-cache-metrics.ts`
- Modify: `src/lib/query-keys.ts`
- Modify: `src/app/(chat)/settings/page.tsx`

- [ ] Write failing tests for daily, provider, project, overall, trend, and zero-token hit-rate aggregation.
- [ ] Implement Prisma aggregation using authenticated user ownership and no schema changes.
- [ ] Read export counters from Redis with zero-valued fallback.
- [ ] Add `GET /api/metrics/cache?days=7` with bounded day validation and unchanged auth conventions.
- [ ] Render a Cache section with overview, CSS bars, provider comparison, export hit rates, and the below-80-percent recommendation.
- [ ] Re-run focused tests.

### Task 8: Message Virtualization and Memoization

**Files:**
- Create: `src/components/chat/virtual-message-list.tsx`
- Create: `src/components/chat/virtual-message-list.test.tsx`
- Modify: `src/components/chat/chat-area.tsx`
- Modify: `src/app/(chat)/projects/[id]/page.tsx`
- Modify: `src/components/chat/message-bubble.tsx`

- [ ] Write failing tests for empty, short, long, and streaming message lists.
- [ ] Implement dynamic measurement with `useVirtualizer`, stable message keys, overscan, and scroll-to-last behavior.
- [ ] Render the final streaming message outside the virtualized completed-message list.
- [ ] Wrap `MessageBubble` in `memo` with a comparator that always observes content changes and relevant interactive props.
- [ ] Re-run focused tests.

### Task 9: Request-Scoped Server Data Layer

**Files:**
- Create: `src/lib/data/conversations.ts`
- Create: `src/lib/data/projects.ts`
- Create: `src/lib/data/messages.ts`
- Create: `src/lib/data/api-keys.ts`
- Modify: `src/app/(chat)/chat/[id]/page.tsx`
- Test: `src/lib/data/conversations.test.ts`

- [ ] Write a failing test that calls the same cached conversation query twice in one render context and observes one Prisma call.
- [ ] Implement `server-only` data functions wrapped in React `cache()` with explicit user ownership parameters.
- [ ] Move the conversation Server Component to `getConversation(id, userId)`.
- [ ] Do not add cross-request `unstable_cache` because authenticated mutable records and the current unknown deployment target make invalidation complexity premature.
- [ ] Re-run focused tests and type checking.

### Task 10: Disabled Cache Experiment Scaffolding

**Files:**
- Create: `src/lib/cache/experiment-config.ts`
- Create: `src/lib/cache/experiment-config.test.ts`
- Create: `src/lib/cache/prompt-reorder.ts`
- Create: `src/lib/cache/prompt-reorder.test.ts`
- Create: `src/lib/cache/minimax-active-cache.ts`
- Create: `src/lib/cache/minimax-active-cache.test.ts`
- Modify: `src/app/api/chat/route.ts`
- Modify: `src/lib/vision/minimax.ts`
- Modify: `.env.example`
- Modify: `src/app/(chat)/settings/page.tsx`

- [ ] Write failing tests proving all experiments default off and disabled helpers return input unchanged.
- [ ] Implement environment-backed immutable config and active-experiment reporting.
- [ ] Add guarded helper calls to chat and MiniMax request assembly; disabled behavior must be byte-for-byte equivalent to current requests.
- [ ] Render non-interactive environment-variable guidance controls in Settings.
- [ ] Re-run focused tests.

### Task 11: Documentation and Full Verification

**Files:**
- Create: `IMPLEMENTATION.md`
- Modify: `docs/project-innovations.md`
- Modify: `README.md`

- [ ] Document each phase, cache ownership, invalidation rules, Redis fallback semantics, environment variables, deployment considerations, and deliberately deferred cross-request database caching.
- [ ] Update project innovations with the four-layer architecture and metrics baseline workflow.
- [ ] Run `npm test`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run build`.
- [ ] Run `docker compose config`.
- [ ] Review `git diff --check` and `git status --short`; do not revert unrelated user changes.
