# LumenLab 学习闭环 P1-C 执行计划：精细来源与原子重建

> 状态：已完成（2026-08-01，四个切片按 S1 → S2 → S3 → S4 顺序提交并推送 origin/main）
> 提交：`64a33d2`（S1 locator v2 + chunk 反查）、`465df8f`（S2 稳定块 key + 原子重建）、`3a1925f`（S3 质量门禁）、`33ae403`（S4 覆盖报告）
> 前置合同：`docs/learning-p1-iteration-plan.md`（P1-A/B/D 已完成，P1-C 是下一个 wave）
> 注意：本文件是执行指令，不是产品文档。每个工作项都写明了改哪个文件、怎么改、如何验收。

## 0. 执行修正记录（与文档正文的偏差，实现时按此处为准）

1. **chunk 反查匹配键**：正文 §5 风险 3 假设 `DocumentChunk.contentHash` 与 `anchor.contentFingerprint` 一致可匹配——侦察后确认不一致：`contentFingerprint` 是 `sha256:v1:<normalize后全文 hex>`（见 `src/lib/files/content-fingerprint.ts`），`contentHash` 是原始全文 sha256 前 32 位（`vector-store.ts`），normalize 差异导致 hash 永不相等。**实际实现**：`resolveBlockLocators` 只按 `fileAssetId` 匹配（chunk 每次解析重建，fileAssetId 即当前解析版本）；旧 anchor 由上游 contentFingerprint 校验（409）拒绝，不会产生脏数据。反查不到时降级 `{ kind: "file" }`，不抛错。
2. **parseReport 持久化**：正文 §S2 第 3 项要求显式写入——确认 `pipeline.ts:80` 已产出 `parseReport`，parse-job 的 `completedMetadata` 展开 `result.metadata` 并经 `mergeMetadata` 写入 `processingMetadata`，**无需改动**。S3 消费路径为 `processingMetadata.parseReport`（`objectJson` + 类型断言）。
3. **`sourceAnchorSnapshotSchema` 的 locator**：改为 `z.union([sourceLocatorSchema, z.record(...)])`（v2 严格 + 旧自由 JSON 兜底），存量 anchor 形状不受影响。
4. **前端 `formatSourceLocator`**：原实现只读 `page/paragraph/block` 平铺字段；已扩展为先处理 v2 判别（block → `第 N 页 · 块 <blockId>`，page → `第 N 页 · 第 N 段`，range → `第 N 页 · start-end`），再回退旧平铺格式。
5. **`buildStudyPackSources` 未做反查**：该函数消费 map 已持久化的 anchors（generateMap 时已是 v2 locator），sources 仅透传给模型（passthrough schema），无持久化消费点，故未加反查逻辑。数据源头在 `buildSourceSnapshots`，`generateMap` 的 anchor upsert 自动落库。

## 1. 目标（来自冻结计划 §6 Wave P1-C）

1. 冻结 locator v2：page、paragraph、block、character range、content fingerprint；
2. DocumentPipeline 输出解析质量和稳定 block key；
3. 构建新索引版本，完整成功后事务切换 active version；
4. 单文件失败保留上一版本并支持重试；
5. 覆盖报告区分 `material_absent` 与 `retrieval_miss`。

验收：来源可定位；低质量解析不能产生高置信度题目；失败重建不破坏上一可用索引。

## 2. 当前现状（2026-08-01 侦察确认，均为代码事实）

### 2.1 来源定位（locator）现状
- `src/lib/learning/validators.ts:22`：`const locatorSchema = z.record(z.string().min(1).max(80), z.unknown());` —— 自由 JSON，无结构约束。
- 学习域实际写入的 locator 全部是文件级：`src/lib/learning/services/learning-service.ts` 的 `buildSourceSnapshots`（约 900 行区域）与 `buildStudyPackSources`（P1-D 新增）都用 `locator: { kind: "file" }`。
- `SourceAnchor` 表（schema.prisma ~898 行）已有 `locator Json`、`contentFingerprint`、`excerptHash`、`documentChunkId String?` 字段（chunk 关联字段存在但未使用）。
- 前端 `src/components/learning/learning-history.tsx` 的 `formatSourceLocator` 已支持 page/paragraph/block 展示，但没有数据可显示。
- 锚点 key 生成：`handle = sha256(projectId + fileId + contentFingerprint)`（确定性，跨重建稳定）。

### 2.2 块与分块现状
- `src/lib/document-pipeline/types.ts:12`：`BaseBlock { type, id, pageNumber?, slideNumber? }`。**所有 parser 的 block.id 都是 `crypto.randomUUID()`**（`parsers/mineru-parser.ts:57`、`parsers/markdown-to-blocks.ts:23,41,61,...`、`parsers/image-parser.ts:88`）——同文件重新解析后 block id 全部变化。
- `src/lib/document-pipeline/chunk-builder.ts`：
  - `ChunkCandidate.id` 也是 `crypto.randomUUID()`（多处）。
  - `metadata` 已含 `blockId`、`pageNumber`、`slideNumber`、`sourceType`、`confidence`、`warnings`（结构已具备，只差稳定 key）。
- `DocumentChunk` 表（schema.prisma ~441 行）：`id`、`userId`、`projectId?`、`fileAssetId?`、`title?`、`content`、`contentHash`（整文件 hash）、`chunkIndex`、`tokenCount?`、`metadata Json?`、`mediaUrls String[]`、`embedding vector(1024)?`。**无版本字段**。

### 2.3 索引重建现状（非原子）
- `src/lib/rag/vector-store.ts:364` `createDocumentChunks`：**先 `deleteMany`（375 行）再 `createMany`（421 行）**，非事务。中途失败 → 旧 chunk 已删、新 chunk 不全。
- `src/lib/files/parse-job.ts`（约 111-167 行）：解析成功 → 更新 FileAsset（textContent + contentFingerprint）→ `recordFileContentChange`（学习新鲜度）→ `createDocumentChunks`（失败仅记录 `chunkWarning`，不中断）→ `embedChunksForFile`（失败仅 log）→ `refreshProjectIndex`（`.catch(() => {})` 吞错）。
- `src/lib/rag/project-index.ts:171` `refreshProjectIndex`：全量重建项目 INDEX（读所有文件 textContent），ProjectIndex 是单行 upsert（原子），但依赖所有文件的当前状态。
- `FileParseJob` 表（schema.prisma ~419 行）：`status/stage/attempt/error/warnings` 已具备，`instrumentation.ts` 启动恢复 stale 任务；已有重试/单文件重试 API（`src/app/api/files/**` 的 parse/retry 路径）。

### 2.4 解析质量现状（有报告无消费）
- `src/lib/document-pipeline/quality-checker.ts:3`：`ParseQualityReport { textCoverageRatio, imageRetainedCount, imageAnalyzedCount, imageSkippedCount, failedImageCount, tableCount, formulaCount, warningCount, estimatedCost?, actualTokenUsage?, checks: [{rule, passed, message?}] }`。
- `ParsingMetadata.parseReport?`（types.ts:70）承载报告；parse-job 把它 merge 进 `FileAsset.processingMetadata`（`mergeMetadata`，parse-job.ts:94）。
- **全仓库没有任何业务代码读取 parseReport**（grep 确认：消费点为零）——"低质量解析不能产生高置信度题目"完全没有实现。

### 2.5 检索与覆盖报告现状
- 检索入口：`searchSimilarChunks`（vector-store.ts:435）、`searchChunksByKeyword`（608）、`hybridSearch`（692）、`retrieveProjectContext`（803）。where 条件全部按 `userId/projectId/fileAssetId` 过滤，无版本概念。
- **`material_absent` / `retrieval_miss` 概念在代码中不存在**（grep 零命中）。

## 3. 实施分解

按可独立提交的切片组织，每个切片完成后跑全量门禁并推送。建议顺序：**S1 → S2 → S3 → S4**。

### S1：locator v2 冻结 + 学习域使用

**目标**：`SourceAnchor.locator` 从"文件级"升级为"可定位到页/段/块"，前端来源展示有真实数据。

**改动**：
1. `src/lib/learning/validators.ts`：把 `locatorSchema`（22 行）从 `z.record` 改为判别联合：
   ```ts
   export const sourceLocatorSchema = z.discriminatedUnion("kind", [
     z.object({ kind: z.literal("file") }).strict(),
     z.object({
       kind: z.literal("page"),
       page: z.number().int().positive(),
       paragraph: z.number().int().positive().optional(),
     }).strict(),
     z.object({
       kind: z.literal("block"),
       blockId: z.string().trim().min(1),
       pageNumber: z.number().int().positive().optional(),
     }).strict(),
     z.object({
       kind: z.literal("range"),
       start: z.number().int().nonnegative(),
       end: z.number().int().positive(),
       page: z.number().int().positive().optional(),
     }).strict(),
   ]);
   ```
   保留旧 `locatorSchema` 别名（`z.lazy(() => sourceLocatorSchema)` 或直接替换，检查引用点：`sourceAnchorSnapshotSchema` 用 `locator` 字段；`SourceAnchorDto`/`LearningHistoryEvidenceDto` 的 locator 类型是 `Record<string, unknown>`，保持兼容）。
2. `src/lib/learning/services/learning-service.ts`：
   - `buildSourceSnapshots` 与 `buildStudyPackSources`：locator 仍从文件级开始，但**新增从 chunk 反查精确位置的逻辑**：对每个 anchor 的 `fileAssetId`，查 `DocumentChunk`（`fileAssetId + contentHash = anchor.contentFingerprint`，取第一个 `metadata.blockId/pageNumber` 非空的 chunk），把 locator 提升为 `{ kind: "block", blockId, pageNumber }`（找不到就保持 `{ kind: "file" }`）。注意：SourceAnchor 已有 `documentChunkId` 字段，创建 anchor 时填入匹配 chunk 的 id。
   - 新增 DTO 透传：`LearningHistoryEvidenceDto` 的 sourceAnchors locator 已是 `Record<string, unknown>`，无需改类型；前端 `formatSourceLocator` 已支持。

**验收**：`getHistory` 返回的来源 locator 至少部分为 `{ kind: "block", ... }` 而非全部 `{ kind: "file" }`；前端档案页显示"第 N 页/块"。

**测试**：`validators.test.ts` 加 locator v2 校验用例；集成测试断言 chunk 反查后 locator 提升。

### S2：稳定块 key + 原子 chunk 重建

**目标**：① 同文件重建后未变化 chunk 有稳定 key（供 diff 与来源定位）；② 重建失败不破坏上一索引。

**改动**：
1. `src/lib/document-pipeline/chunk-builder.ts`：
   - `ChunkCandidate` 增加 `blockKey: string`（确定性派生：`sha256(block.id + ":" + chunkIndex + ":" + content).slice(0, 24)`——注意 block.id 本身随机，但 key 的目的不是跨解析稳定，而是**同一解析结果内稳定 + 内容可追溯**；真正跨重建稳定由 S1 的 chunk 反查承担）。
   - 若追求更强稳定性：`metadata` 增加 `contentFingerprint`（chunk 内容自身的 hash）供跨重建对比。
2. `src/lib/rag/vector-store.ts` `createDocumentChunks`（364-433 行）：把 `deleteMany` + `createMany` 包进 **interactive transaction**（`prisma.$transaction(async (tx) => {...})`），失败整体回滚 → 旧 chunk 保留。返回前保留现有 `invalidateSearchCache(projectId)` 调用（放在事务外）。
3. `src/lib/files/parse-job.ts`：`createDocumentChunks` 的 catch 分支目前只记录 `chunkWarning` —— 保持（事务回滚后旧索引仍在，警告语义不变），但把 `result.metadata.parseReport` 显式写入 `processingMetadata.parseReport`（确认字段路径），供 S3 消费。

**验收**：单元测试 mock 事务失败 → 旧 chunk 行数不变；集成测试验证事务回滚后 DocumentChunk 无残留半成品。

**测试**：`vector-store` 相关测试（`src/lib/rag/` 下现有测试文件），`parse-job` 测试已有（`parse-job.test.ts`）。

### S3：解析质量门禁（低质量 → 不高置信度）

**目标**：ParseQualityReport 被消费——低质量解析的题目/知识点生成被限制或拒绝。

**改动**：
1. 新增 `src/lib/document-pipeline/quality-gate.ts`（纯函数）：
   ```ts
   export type QualityGateDecision =
     | { allowed: true }
     | { allowed: false; reason: string };
   export function gateHighConfidenceGeneration(
     report: ParseQualityReport | null | undefined,
     options?: { minTextCoverage?: number; maxFailedImages?: number; maxWarnings?: number }
   ): QualityGateDecision;
   ```
   默认规则：`textCoverageRatio < 0.5`、`failedImageCount > 3`、`warningCount > 10` 之一成立 → 拒绝高置信度生成。`report` 缺失（旧数据）时视为通过（向后兼容，不阻断存量）。
2. `src/lib/learning/services/learning-service.ts`：在 `generateMap`、`createDiagnosticSession`（generatePracticeItems 前）、`buildStudyPackSources`（P1-D 的生成路径）前置调用：对 scope 内每个 source file 读 `processingMetadata.parseReport`（Prisma JSON 解析），任一文件不通过 → 抛 `LearningServiceError("source_unsupported", "部分资料解析质量不足，无法生成高置信度题目，请重新解析后重试", 409)`。生成题目时若拒绝，允许用户显式降级（MVP 不做降级，直接拒绝并提示重解析）。
   - 注意 `processingMetadata` 是 `Json?`，读取后需 `objectJson()` + 类型断言到 `ParseQualityReport`。
3. 模型 prompt 不变（门禁在服务层做，不动 gateway）。

**验收**：集成测试注入 `parseReport` 低质量 → 生成拒绝；无报告 → 通过。

**测试**：`quality-gate.test.ts`（纯函数单测）+ 集成测试。

### S4：覆盖报告 material_absent / retrieval_miss

**目标**：区分"资料里没有"与"资料里有但没检索到"，学习域与聊天 RAG 可复用。

**改动**：
1. 新增 `src/lib/rag/coverage.ts`：
   ```ts
   export type CoverageVerdict = "material_absent" | "retrieval_miss" | "covered";
   export async function classifyCoverage(params: {
     userId: string; projectId: string;
     query: string;                    // 需要验证的主题/关键词
     retrievalResults: Array<{ fileAssetId: string | null; content: string }>;
   }): Promise<CoverageVerdict>;
   ```
   逻辑：`retrievalResults` 有与 query 相关的命中 → `covered`；否则做一次**全库 keyword 兜底扫描**（复用 `searchChunksByKeyword` 或直接 `DocumentChunk` 的 `content contains`，与 vector-store.ts:621-627 的模式一致），命中 → `retrieval_miss`；零命中 → `material_absent`。
2. 接入学习域：`generateMap` / `createDiagnosticSession` 生成结果中若 `sourceHandles` 全部无效或模型报"资料中无此内容"，把覆盖结论返回给用户（DTO 增加可选字段或错误消息区分）。MVP 最小接入：`LearningServiceError` 的 message 区分两种原因。
3. 接入聊天 RAG（可选增强，若切片时间允许）：`retrieveProjectContext` 返回 `coverageVerdict`，前端 sources 区显示"资料中未找到相关内容"。

**验收**：单测覆盖三分类（构造：有命中 / 无命中但资料存在 / 资料不存在）；学习域生成失败信息区分两类原因。

**测试**：`coverage.test.ts` + 集成测试。

## 4. 涉及文件汇总

| 文件 | 动作 |
|---|---|
| `src/lib/learning/validators.ts` | locator v2 判别联合（S1） |
| `src/lib/learning/services/learning-service.ts` | chunk 反查提升 locator、质量门禁、覆盖报告接入（S1/S3/S4） |
| `src/lib/document-pipeline/chunk-builder.ts` | blockKey/contentFingerprint（S2） |
| `src/lib/rag/vector-store.ts` | createDocumentChunks 事务化（S2） |
| `src/lib/files/parse-job.ts` | parseReport 显式持久化（S2） |
| `src/lib/document-pipeline/quality-gate.ts` | 新文件（S3） |
| `src/lib/rag/coverage.ts` | 新文件（S4） |
| `src/lib/learning/server/input-schemas.ts` | 若覆盖报告需要参数（可选） |
| `prisma/schema.prisma` | **预期不需要迁移**（事务方案无版本字段；若 S1 需要 chunk 反查字段，`documentChunkId` 已存在） |

## 5. 风险与注意事项

1. **不要动检索路径的读取语义**：`searchChunksByKeyword`/`hybridSearch`/`retrieveProjectContext` 的 where 条件保持不变，P1-C 只改写入路径的原子性。改动会触碰线上 RAG，任何写路径改动必须跑全量测试 + 真实浏览器聊天回归。
2. **parseReport 缺失兼容**：存量文件没有 parseReport，质量门禁必须放行（向后兼容），只对新解析结果生效。
3. **chunk 反查的匹配**：`DocumentChunk.contentHash` 是整文件 hash，与 `anchor.contentFingerprint` 一致才能匹配；`buildSourceSnapshots` 的 anchor 基于 scope 内文件，chunk 可能因 embedding 失败而缺失——反查不到时降级为 `{ kind: "file" }`，不能抛错。
4. **事务内不要调用 `invalidateSearchCache`**（网络/缓存副作用留在事务外）。
5. 现有 `parse-job.test.ts`、`vector-store` 测试、`learning-service.integration.test.ts` 是主要回归面；`quality-checker` 已有测试（`quality-checker.test.ts` 在 `__tests__` 下）。
6. 完成后更新：`docs/learning-p1-iteration-plan.md`（P1-C 完成记录 + 状态行）、`docs/TODO.md`、`REPOSITORY_INDEX.md`（gitignored，本地维护）、根目录 `log.md`。

## 6. 验证矩阵（每个切片）

1. `npx tsc --noEmit`、`npm run lint`、`git diff --check`
2. `npm test`（全量单元测试）+ `npx vitest run --config vitest.integration.config.ts src/lib/learning/services/learning-service.integration.test.ts`（集成）
3. 新增切片对应单测（quality-gate / coverage / locator v2 / 事务回滚）
4. `npm run build`
5. 真实浏览器（本地 dev server + QA 账号，参照 P1-B/D 的 QA 流程）：档案页来源显示页码/块位；解析失败注入时旧索引可用
6. 提交消息建议：`feat: add precise learning sources and atomic rebuilds`（一个切片一提交，可回滚）

## 7. 执行顺序

S1（来源定位）→ S2（原子重建）→ S3（质量门禁）→ S4（覆盖报告）。S1/S2 可并行侦察但按序提交；S3 依赖 S2 的 parseReport 持久化；S4 独立可最后做。
