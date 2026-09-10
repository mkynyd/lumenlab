/**
 * search-providers-smoke — AnySearch / Sciverse /（可选）arXiv 的正式 live smoke。
 *
 * 合并原 anysearch-smoke / sciverse-smoke / research-channel-diag 三个临时脚本。
 * 只读外部检索服务，不创建任何数据库记录（--require-sciverse-content 也走
 * 直接执行的 ToolRunner，不持久化 ToolExecution）。
 *
 * 用法（服务器或本地均可，env 从 .env 注入，绝不打印任何 Token）：
 *   LUMENLAB_LIVE_SMOKE=1 npx tsx --tsconfig scripts/tsconfig.json --env-file=.env scripts/search-providers-smoke.ts \
 *     [--with-arxiv] [--with-paper-relations] [--with-advanced-filters] [--with-resource] [--require-sciverse-content]
 *
 * --require-sciverse-content（严格模式）：在有限的搜索窗口内优先选择
 * isContentAccessible=true 的论文，走 Research source provider 的完整
 * semantic_search(docIds scope) → read 链路，验证 chunk 级 locator/provenance。
 * 窗口内找不到可访问全文时输出 [WARN] 并跳过，不把 metadata 冒充正文。
 *
 * --with-advanced-filters：验证 catalog-aware compiler 的 live 行为
 * （/meta-catalog → 受控 filterIntent → /meta-search），并确认未校验的字段
 * 永远不会被转发。
 * --with-resource：在有全文的论文正文里定位图表引用并拉取一张图片，验证
 * /resource 的受限相对路径与图片 bytes 合同。找不到图表记 WARN，不伪造通过。
 * 所有检查都在有限窗口内完成，禁止为了 PASS 无限搜索。
 */
import type { ToolRunner } from "@/lib/agent/tools/tool-runner";
import { executeTool, registerToolHandler } from "@/lib/agent/tool-executor";
import { webSearch } from "@/lib/tools/web/search";
import { arxivSearch } from "@/lib/tools/arxiv/search";
import { sciversePaperRelations, sciverseRead, sciverseResource, sciverseSearch, sciverseSemanticSearch } from "@/lib/tools/sciverse/handlers";
import { invalidateSciverseCatalogCache } from "@/lib/tools/sciverse/catalog";
import { createToolBackedResearchSourceProvider, type ResearchCandidate } from "@/lib/research/source-provider";
import { createDiagnosticsReporter, parseCliArgs, requireLiveSmoke } from "./lib/live-diagnostics";

const SCRIPT = "search-providers-smoke";
const ctx = { userId: "smoke", conversationId: "smoke" } as never;

function isErrorResult(value: unknown): value is { error: string } {
  return Boolean(value && typeof value === "object" && "error" in (value as Record<string, unknown>));
}

/** 直接执行 ToolRunner：只注册 Sciverse 三个 handler，复用线上 wire contract，但不写 ToolExecution。 */
function createDirectToolRunner(signal: AbortSignal): ToolRunner {
  registerToolHandler("sciverse.search", sciverseSearch);
  registerToolHandler("sciverse.semantic_search", sciverseSemanticSearch);
  registerToolHandler("sciverse.read", sciverseRead);
  registerToolHandler("sciverse.resource", sciverseResource);
  return {
    run: async (request: { call: { toolId: string; arguments: Record<string, unknown> } }) => {
      const executed = await executeTool(request.call.toolId, { userId: "smoke", conversationId: "smoke", signal }, request.call.arguments);
      return executed.ok
        ? { status: "succeeded" as const, executionId: "smoke", summary: executed.result }
        : { status: "failed" as const, error: { code: executed.errorCode ?? "ERROR", message: executed.errorMessage ?? "tool failed" } };
    },
  } as unknown as ToolRunner;
}


interface ResourceProbe {
  status: "pass" | "warn" | "fail";
  label: string;
  detail?: unknown;
}

/**
 * 有界图表探测：最多 2 次 semantic_search + 2 次 read，找到图片占位就拉一张。
 * 窗口内没有全文或没有图表一律 WARN，不无限搜索、不伪造通过。
 */
async function probeSciverseResource(): Promise<ResourceProbe> {
  const semantic = await sciverseSemanticSearch(ctx, { query: "results figure table experiment", topK: 5 });
  const hits = !isErrorResult(semantic) && Array.isArray((semantic as { hits?: unknown[] }).hits)
    ? (semantic as { hits: Array<Record<string, unknown>> }).hits
    : [];
  const docIds = [...new Set(hits.flatMap((hit) => (typeof hit.docId === "string" ? [hit.docId] : [])))].slice(0, 2);
  if (docIds.length === 0) return { status: "warn", label: "no readable document in the search window; skipping resource check" };

  for (const docId of docIds) {
    for (const offset of [0, 6_000]) {
      const read = await sciverseRead(ctx, { docId, offset, limit: 6_000 });
      if (isErrorResult(read)) continue;
      const refs = Array.isArray((read as { resources?: unknown[] }).resources) ? (read as { resources: Array<Record<string, unknown>> }).resources : [];
      const reference = refs.find((ref) => typeof ref.fileName === "string");
      if (!reference) continue;
      const fetched = await sciverseResource(ctx, { fileName: reference.fileName as string, docId });
      if (isErrorResult(fetched)) {
        if (fetched.error === "SCIVERSE_RESOURCE_UNAVAILABLE" || fetched.error === "SCIVERSE_RATE_LIMITED") {
          return { status: "warn", label: "sciverse.resource degraded for the discovered figure", detail: { error: fetched.error } };
        }
        return { status: "fail", label: "sciverse.resource failed", detail: { error: fetched.error } };
      }
      const payload = fetched as { mimeType?: unknown; byteLength?: unknown; dataIncluded?: unknown };
      if (typeof payload.mimeType === "string" && payload.mimeType.startsWith("image/") && Number(payload.byteLength) > 0) {
        return {
          status: "pass",
          label: "sciverse.resource returned bounded image bytes for a discovered figure",
          detail: { mimeType: payload.mimeType, byteLength: payload.byteLength, dataIncluded: payload.dataIncluded === true, kind: reference.kind },
        };
      }
      return { status: "fail", label: "sciverse.resource returned a non-image or empty payload", detail: { mimeType: payload.mimeType, byteLength: payload.byteLength } };
    }
  }
  return { status: "warn", label: "no figure/table reference inside the bounded read window; skipping resource check" };
}

async function main() {
  const { flags } = parseCliArgs(process.argv.slice(2));
  if (!requireLiveSmoke(SCRIPT, `npx tsx --tsconfig scripts/tsconfig.json --env-file=.env scripts/${SCRIPT}.ts [--with-arxiv] [--with-paper-relations] [--require-sciverse-content]`)) {
    process.exit(0);
  }
  const report = createDiagnosticsReporter(SCRIPT);

  // 1. web.search（AnySearch primary）
  const web = await webSearch(ctx, "LumenLab deep research", { maxResults: 3 });
  const webSources = Array.isArray(web.sources) ? web.sources : [];
  if (webSources.length > 0 && webSources[0]?.url) {
    report.pass("web.search (AnySearch) returned sources", { count: webSources.length, firstUrlHost: new URL(webSources[0].url).host });
  } else {
    report.fail("web.search (AnySearch) returned no usable source");
  }

  // 2. sciverse.search
  const search = await sciverseSearch(ctx, { titleContains: "Attention Is All You Need", pageSize: 3 });
  const papers = !isErrorResult(search) && Array.isArray((search as { papers?: unknown[] }).papers)
    ? (search as { papers: Array<Record<string, unknown>> }).papers
    : [];
  if (papers.length > 0 && typeof papers[0].uniqueId === "string" && typeof papers[0].title === "string") {
    report.pass("sciverse.search returned papers with stable identity", {
      count: papers.length,
      hasDocId: typeof papers[0].docId === "string",
      isContentAccessible: papers[0].isContentAccessible === true,
    });
  } else {
    report.fail("sciverse.search failed or returned no paper identity", isErrorResult(search) ? { error: search.error } : undefined);
  }

  // 3. sciverse.semantic_search
  const semantic = await sciverseSemanticSearch(ctx, {
    query: "How do transformer models handle long-range dependencies in sequences?",
    topK: 3,
  });
  const hits = !isErrorResult(semantic) && Array.isArray((semantic as { hits?: unknown[] }).hits)
    ? (semantic as { hits: Array<Record<string, unknown>> }).hits
    : [];
  const firstHit = hits.find((hit) => typeof hit.docId === "string");
  if (firstHit) {
    report.pass("sciverse.semantic_search returned evidence hits", {
      count: hits.length,
      hasChunkId: typeof firstHit.chunkId === "string",
      hasOffset: typeof firstHit.offset === "number",
      hasScore: typeof firstHit.score === "number",
    });
  } else {
    report.fail("sciverse.semantic_search returned no hit with docId", isErrorResult(semantic) ? { error: semantic.error } : undefined);
  }

  // 4. sciverse.read（仅在有 docId 时，bounded slice）
  if (firstHit && typeof firstHit.docId === "string") {
    const read = await sciverseRead(ctx, { docId: firstHit.docId, offset: Math.max(0, Number(firstHit.offset) || 0), limit: 600 });
    const text = !isErrorResult(read) ? (read as { text?: unknown }).text : null;
    if (typeof text === "string" && text.trim()) {
      report.pass("sciverse.read returned bounded slice", { returnedChars: (read as { returnedChars?: unknown }).returnedChars, more: (read as { more?: unknown }).more });
    } else {
      report.warn("sciverse.read unavailable for hit (content may not be accessible)", isErrorResult(read) ? { error: read.error } : undefined);
    }
  }

  // 5. arXiv（可选通道；瞬时降级记 WARN，不算 correctness failure）
  if (flags.has("with-arxiv")) {
    const arxiv = await arxivSearch("mixture of experts routing", 3);
    if (!isErrorResult(arxiv) && Number(arxiv.count) > 0) {
      report.pass("arxiv.search returned results", { count: arxiv.count });
    } else {
      report.warn("arxiv.search degraded (retry-exhausted or unreachable)", isErrorResult(arxiv) ? { error: arxiv.error } : undefined);
    }
  }

  // 5b. sciverse.paper_relations（可选；用 search 到的真实 uniqueId 验证一页 relation contract）
  if (flags.has("with-paper-relations")) {
    const seedPaper = papers.find((paper) => typeof paper.uniqueId === "string");
    if (!seedPaper) {
      report.warn("no paper with uniqueId in window; skipping paper_relations check");
    } else {
      const relations = await sciversePaperRelations(ctx, { uniqueId: seedPaper.uniqueId as string, relation: "references", pageSize: 5 });
      if (isErrorResult(relations)) {
        // 404（论文无关系数据）与限流属可恢复降级；鉴权/配置错误是 correctness failure。
        const code = relations.error;
        if (code === "SCIVERSE_NOT_FOUND" || code === "SCIVERSE_RATE_LIMITED" || code === "SCIVERSE_UNAVAILABLE") {
          report.warn("sciverse.paper_relations degraded", { error: code });
        } else {
          report.fail("sciverse.paper_relations failed", { error: code });
        }
      } else {
        const items = Array.isArray((relations as { items?: unknown[] }).items) ? (relations as { items: Array<Record<string, unknown>> }).items : [];
        const shapeOk = items.every((item) => typeof item.id === "string" && typeof item.idType === "string");
        if (shapeOk && (relations as { relation?: unknown }).relation === "references") {
          report.pass("sciverse.paper_relations returned one bounded page", {
            items: items.length,
            totalCount: (relations as { totalCount?: unknown }).totalCount,
            idTypes: [...new Set(items.map((item) => item.idType))],
          });
        } else {
          report.fail("sciverse.paper_relations returned malformed items");
        }
      }
    }
  }

  // 5c. catalog-aware advanced filters（可选；live catalog → 受控 filterIntent）
  if (flags.has("with-advanced-filters")) {
    invalidateSciverseCatalogCache();
    const filtered = await sciverseSearch(ctx, {
      query: "mixture of experts routing",
      pageSize: 5,
      filterIntent: { languages: ["en"], citationCountMin: 1 },
    });
    if (isErrorResult(filtered)) {
      report.fail("sciverse.search with catalog-aware filterIntent failed", { error: filtered.error });
    } else {
      const provenance = (filtered as { advancedFilters?: Record<string, unknown> }).advancedFilters ?? {};
      const applied = Array.isArray(provenance.applied) ? provenance.applied : [];
      const catalog = String(provenance.catalog ?? "unavailable");
      if (catalog === "unavailable") {
        // 上游 catalog 瞬时不可用属受支持降级：高级条件被整体丢弃，基础检索仍可用。
        report.warn("sciverse field catalog unavailable; advanced filters degraded to basic search", { catalog });
      } else if (applied.length > 0) {
        report.pass("catalog-aware advanced filters compiled and executed", {
          catalog,
          applied: applied.map((entry) => (entry as { field?: string }).field).filter(Boolean),
          dropped: Array.isArray(provenance.dropped) ? (provenance.dropped as unknown[]).length : 0,
          relaxedRetry: provenance.relaxedRetry === true,
        });
      } else {
        report.fail("catalog-aware filterIntent produced no applied filter despite a live catalog", { catalog });
      }
    }
    // 未校验的原始 field/operator 必须被拒绝，绝不能作为 wire filter 转发。
    const rawPassthrough = await sciverseSearch(ctx, {
      query: "mixture of experts routing",
      filterIntent: { field: "access_is_oa", operator: "FILTER_OP_EQ", value: "true" },
    });
    if (isErrorResult(rawPassthrough) && rawPassthrough.error === "SCIVERSE_INVALID_REQUEST") {
      report.pass("raw field/operator passthrough rejected by the intent contract");
    } else {
      report.fail("raw field/operator passthrough was not rejected");
    }
  }

  // 5d. 图表资源（可选；在有限窗口内定位一张图并验证受限路径 + 图片 bytes）
  if (flags.has("with-resource")) {
    const resource = await probeSciverseResource();
    if (resource.status === "pass") report.pass(resource.label, resource.detail);
    else if (resource.status === "warn") report.warn(resource.label, resource.detail);
    else report.fail(resource.label, resource.detail);
  }

  // 6. 严格模式：验证 Sciverse 全文可访问论文的 chunk 级 Research 读取链路
  if (flags.has("require-sciverse-content")) {
    const window = await sciverseSearch(ctx, { query: "transformer attention mechanism", pageSize: 10 });
    const windowPapers = !isErrorResult(window) && Array.isArray((window as { papers?: unknown[] }).papers)
      ? (window as { papers: Array<Record<string, unknown>> }).papers
      : [];
    // doc_id 是全文 artifact 哈希：存在即代表可尝试有界正文读取。上游 meta-search
    // 的 is_content_accessible 在生产恒为 false（即使 doc_id 存在且 /content 可读），
    // 因此不能作为判定依据——与 Research source provider 使用同一门槛。
    const accessible = windowPapers.find((paper) => typeof paper.docId === "string" && paper.docId.length > 0 && typeof paper.uniqueId === "string");
    if (!accessible) {
      report.warn("no paper with a full-text doc_id in search window; skipping full-text evidence check", { window: windowPapers.length });
    } else {
      const provider = createToolBackedResearchSourceProvider({ toolRunner: createDirectToolRunner(new AbortController().signal), academicAdapters: [] });
      const candidate: ResearchCandidate = {
        provider: "sciverse",
        kind: "academic_paper",
        externalId: typeof accessible.doi === "string" ? accessible.doi : String(accessible.docId),
        title: String(accessible.title ?? ""),
        url: typeof accessible.url === "string" ? accessible.url : null,
        metadata: { doi: accessible.doi ?? null, docId: accessible.docId, uniqueId: accessible.uniqueId, isContentAccessible: accessible.isContentAccessible === true },
      };
      const readResult = await provider.read(
        { userId: "smoke", conversationId: "smoke", executionId: "smoke", runId: "smoke", signal: new AbortController().signal, question: "How do transformer models handle long-range dependencies?" },
        candidate,
      );
      const slices = readResult?.slices ?? [];
      const locator = (slices[0]?.locator ?? {}) as Record<string, unknown>;
      const provenance = (slices[0]?.provenance ?? {}) as Record<string, unknown>;
      if (
        slices.length > 0
        && locator.kind === "sciverse"
        && typeof locator.docId === "string"
        && (typeof locator.chunkId === "string" || typeof locator.offset === "number")
        && typeof provenance.retrievalMethod === "string"
        && (provenance.retrievalMethod as string).startsWith("sciverse.")
      ) {
        report.pass("sciverse full-text evidence chain (search → semantic scope → read) produced chunk-level locator/provenance", {
          slices: slices.length,
          retrievalMethod: provenance.retrievalMethod,
          hasSemanticScore: typeof provenance.semanticScore === "number",
        });
      } else {
        report.fail("accessible sciverse paper did not produce chunk-level evidence slices");
      }
    }
  }

  process.exit(report.summarize());
}

main().catch((error) => {
  console.error(`[${SCRIPT}] crashed:`, error instanceof Error ? error.message : String(error));
  process.exit(1);
});
