/**
 * search-providers-smoke — AnySearch / Sciverse /（可选）arXiv 的正式 live smoke。
 *
 * 合并原 anysearch-smoke / sciverse-smoke / research-channel-diag 三个临时脚本。
 * 只读外部检索服务，不创建任何数据库记录（--require-sciverse-content 也走
 * 直接执行的 ToolRunner，不持久化 ToolExecution）。
 *
 * 用法（服务器或本地均可，env 从 .env 注入，绝不打印任何 Token）：
 *   LUMENLAB_LIVE_SMOKE=1 npx tsx --tsconfig scripts/tsconfig.json --env-file=.env scripts/search-providers-smoke.ts [--with-arxiv] [--require-sciverse-content]
 *
 * --require-sciverse-content（严格模式）：在有限的搜索窗口内优先选择
 * isContentAccessible=true 的论文，走 Research source provider 的完整
 * semantic_search(docIds scope) → read 链路，验证 chunk 级 locator/provenance。
 * 窗口内找不到可访问全文时输出 [WARN] 并跳过，不把 metadata 冒充正文。
 */
import type { ToolRunner } from "@/lib/agent/tools/tool-runner";
import { executeTool, registerToolHandler } from "@/lib/agent/tool-executor";
import { webSearch } from "@/lib/tools/web/search";
import { arxivSearch } from "@/lib/tools/arxiv/search";
import { sciverseRead, sciverseSearch, sciverseSemanticSearch } from "@/lib/tools/sciverse/handlers";
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
  return {
    run: async (request: { call: { toolId: string; arguments: Record<string, unknown> } }) => {
      const executed = await executeTool(request.call.toolId, { userId: "smoke", conversationId: "smoke", signal }, request.call.arguments);
      return executed.ok
        ? { status: "succeeded" as const, executionId: "smoke", summary: executed.result }
        : { status: "failed" as const, error: { code: executed.errorCode ?? "ERROR", message: executed.errorMessage ?? "tool failed" } };
    },
  } as unknown as ToolRunner;
}

async function main() {
  const { flags } = parseCliArgs(process.argv.slice(2));
  if (!requireLiveSmoke(SCRIPT, `npx tsx --tsconfig scripts/tsconfig.json --env-file=.env scripts/${SCRIPT}.ts [--with-arxiv] [--require-sciverse-content]`)) {
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

  // 6. 严格模式：验证 Sciverse 全文可访问论文的 chunk 级 Research 读取链路
  if (flags.has("require-sciverse-content")) {
    const window = await sciverseSearch(ctx, { query: "transformer attention mechanism", pageSize: 10 });
    const windowPapers = !isErrorResult(window) && Array.isArray((window as { papers?: unknown[] }).papers)
      ? (window as { papers: Array<Record<string, unknown>> }).papers
      : [];
    const accessible = windowPapers.find((paper) => paper.isContentAccessible === true && typeof paper.docId === "string" && typeof paper.uniqueId === "string");
    if (!accessible) {
      report.warn("no isContentAccessible paper in search window; skipping full-text evidence check", { window: windowPapers.length });
    } else {
      const provider = createToolBackedResearchSourceProvider({ toolRunner: createDirectToolRunner(new AbortController().signal), academicAdapters: [] });
      const candidate: ResearchCandidate = {
        provider: "sciverse",
        kind: "academic_paper",
        externalId: typeof accessible.doi === "string" ? accessible.doi : String(accessible.docId),
        title: String(accessible.title ?? ""),
        url: typeof accessible.url === "string" ? accessible.url : null,
        metadata: { doi: accessible.doi ?? null, docId: accessible.docId, uniqueId: accessible.uniqueId, isContentAccessible: true },
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
