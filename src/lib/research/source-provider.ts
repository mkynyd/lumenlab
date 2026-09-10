import { createHash, randomUUID } from "node:crypto";
import { createPrismaToolRunner } from "@/lib/agent/tools/tool-runner";
import type { ToolRunner } from "@/lib/agent/tools/tool-runner";
import { createAcademicSourceAdapters, type AcademicSourceAdapter } from "./academic-adapters";
import { normalizeDoi } from "./source-identity";

export interface ResearchProviderContext {
  userId: string;
  conversationId: string;
  executionId: string;
  runId: string;
  projectId?: string | null;
  signal: AbortSignal;
  /** 当前 Research Question 原文；Sciverse 语义证据检索按问题取 chunk。 */
  question?: string;
}

export interface ResearchCandidate {
  provider: string;
  kind: "web" | "arxiv" | "project_file" | "academic_paper" | "doi" | "pmid";
  externalId: string;
  title: string;
  url: string | null;
  metadata: Record<string, unknown>;
}

/** chunk 级证据切片：一段有界原始正文 + 定位与 provenance，对应一条 Evidence。 */
export interface ReadResearchSourceSlice {
  excerpt: string;
  locator: Record<string, unknown>;
  provenance: Record<string, unknown>;
}

export type ResearchReadEvidenceType = "direct_quote" | "paraphrase" | "dataset_measurement" | "project_context" | "expert_assessment";

export interface ReadResearchSource {
  candidate: ResearchCandidate;
  title: string;
  content: string;
  excerpt: string;
  locator: Record<string, unknown>;
  sourceVersion: string | null;
  metadata: Record<string, unknown>;
  /** 存在时 ingestion 为每个 slice 各建一条 chunk 级 Evidence。 */
  slices?: ReadResearchSourceSlice[];
  /** 原始 source text 为 direct_quote；缺省时由 ingestion 按 candidate kind 决定。 */
  evidenceType?: ResearchReadEvidenceType;
  /** Snapshot metadata.scope：明确本次读取的范围（有界 slice，不是全文）。 */
  snapshotScope?: Record<string, unknown>;
}

export interface ResearchSourceProvider {
  search(context: ResearchProviderContext, question: string): Promise<ResearchCandidate[]>;
  read(context: ResearchProviderContext, candidate: ResearchCandidate): Promise<ReadResearchSource | null>;
}

const SCIVERSE_SEARCH_PAGE_SIZE = 10;
const SCIVERSE_SEMANTIC_TOP_K = 4;
const SCIVERSE_READ_LIMIT = 1_600;
const SCIVERSE_SLICE_MAX_CHARS = 2_000;

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
}

function hashQuery(query: string): string {
  return createHash("sha256").update(query).digest("hex").slice(0, 16);
}

function sciverseCandidate(paper: Record<string, unknown>): ResearchCandidate | null {
  const uniqueId = stringValue(paper.uniqueId);
  const title = stringValue(paper.title);
  if (!uniqueId || !title) return null;
  const doi = normalizeDoi(stringValue(paper.doi));
  const docId = stringValue(paper.docId);
  const externalId = doi ?? docId ?? uniqueId;
  const url = stringValue(paper.url) ?? (doi ? `https://doi.org/${doi}` : null);
  return {
    provider: "sciverse",
    kind: "academic_paper",
    externalId,
    title,
    url,
    metadata: {
      doi,
      docId,
      uniqueId,
      authors: stringArray(paper.authors),
      year: numberValue(paper.year),
      venue: stringValue(paper.venue),
      citationCount: numberValue(paper.citationCount),
      influentialCitationCount: numberValue(paper.influentialCitationCount),
      fwci: numberValue(paper.fwci),
      isOpenAccess: paper.isOpenAccess === true,
      isContentAccessible: paper.isContentAccessible === true,
      abstractPreview: stringValue(paper.abstractPreview),
    },
  };
}

export function createToolBackedResearchSourceProvider(input: { toolRunner?: ToolRunner; academicAdapters?: AcademicSourceAdapter[] } = {}): ResearchSourceProvider {
  const toolRunner = input.toolRunner ?? createPrismaToolRunner();
  const academicAdapters = input.academicAdapters ?? createAcademicSourceAdapters();

  async function runTool(context: ResearchProviderContext, toolId: string, args: Record<string, unknown>) {
    const result = await toolRunner.run(
      {
        call: { id: randomUUID(), toolId, arguments: args },
        context: {
          userId: context.userId,
          conversationId: context.conversationId,
          projectId: context.projectId ?? undefined,
          runId: context.runId,
          agentExecutionId: context.executionId,
          skillId: "literature-review",
          signal: context.signal,
          sessionApprovals: new Map(),
        },
      },
      () => undefined
    );
    return result.status === "succeeded" ? result.summary : null;
  }

  async function searchAcademic(context: ResearchProviderContext, question: string): Promise<ResearchCandidate[]> {
    // Sciverse 是学术检索主通道：返回有效结果时不再 fan-out 到 legacy adapters；
    // 未配置 / 明确不可用 / 空结果时才回退 OpenAlex/Crossref/Semantic Scholar/PubMed。
    const sciverse = await runTool(context, "sciverse.search", { query: question, pageSize: SCIVERSE_SEARCH_PAGE_SIZE });
    if (sciverse && typeof sciverse === "object" && !("error" in sciverse)) {
      const papers = Array.isArray((sciverse as Record<string, unknown>).papers) ? (sciverse as Record<string, unknown>).papers as unknown[] : [];
      const mapped = papers.flatMap((paper) => {
        if (!paper || typeof paper !== "object") return [];
        const candidate = sciverseCandidate(paper as Record<string, unknown>);
        return candidate ? [candidate] : [];
      });
      if (mapped.length > 0) return mapped;
    }
    const academicResults = await Promise.all(academicAdapters.map(async (adapter) => {
      try {
        return await adapter.search(context, question);
      } catch {
        return [];
      }
    }));
    return academicResults.flat();
  }

  async function readSciverseCandidate(context: ResearchProviderContext, candidate: ResearchCandidate): Promise<ReadResearchSource | null> {
    const metadata = candidate.metadata;
    const docId = stringValue(metadata.docId);
    const uniqueId = stringValue(metadata.uniqueId);
    const doi = normalizeDoi(stringValue(metadata.doi));
    const year = numberValue(metadata.year);
    const sourceVersion = year ? String(year) : null;
    const baseMetadata = { provider: "sciverse", ...metadata };

    if (docId && metadata.isContentAccessible === true) {
      const question = context.question?.trim() || candidate.title;
      const semantic = await runTool(context, "sciverse.semantic_search", {
        query: question,
        topK: SCIVERSE_SEMANTIC_TOP_K,
        filters: { docIds: [docId] },
      });
      const hits = semantic && typeof semantic === "object" && !("error" in semantic) && Array.isArray((semantic as Record<string, unknown>).hits)
        ? (semantic as Record<string, unknown>).hits as unknown[]
        : [];
      const slices: ReadResearchSourceSlice[] = [];
      for (const rawHit of hits) {
        if (!rawHit || typeof rawHit !== "object") continue;
        const hit = rawHit as Record<string, unknown>;
        if (stringValue(hit.docId) !== docId) continue;
        const offset = numberValue(hit.offset) ?? 0;
        const score = numberValue(hit.score);
        let text: string | null = null;
        let retrievalMethod = "sciverse.semantic_search";
        const slice = await runTool(context, "sciverse.read", { docId, offset, limit: SCIVERSE_READ_LIMIT });
        if (slice && typeof slice === "object" && !("error" in slice)) {
          const sliceText = stringValue((slice as Record<string, unknown>).text);
          if (sliceText) {
            text = sliceText;
            retrievalMethod = "sciverse.read";
          }
        }
        if (!text) text = stringValue(hit.chunk);
        if (!text) continue;
        slices.push({
          excerpt: text.slice(0, SCIVERSE_SLICE_MAX_CHARS),
          locator: {
            kind: "sciverse",
            docId,
            chunkId: stringValue(hit.chunkId),
            offset,
            pageNo: numberValue(hit.pageNo),
            doi,
            url: candidate.url,
          },
          provenance: {
            provider: "sciverse",
            discovery: "sciverse.search",
            retrievalMethod,
            semanticScore: score,
            queryHash: hashQuery(question),
            sourceType: stringValue(hit.sourceType),
            identifiers: { uniqueId, docId, doi },
          },
        });
        if (slices.length >= SCIVERSE_SEMANTIC_TOP_K) break;
      }
      if (slices.length > 0) {
        const content = slices.map((slice) => slice.excerpt).join("\n\n");
        return {
          candidate,
          title: candidate.title,
          content,
          excerpt: slices[0].excerpt.replace(/\s+/g, " ").trim().slice(0, 800),
          locator: slices[0].locator,
          sourceVersion,
          metadata: baseMetadata,
          slices,
          evidenceType: "direct_quote",
          snapshotScope: {
            type: "bounded_evidence_slices",
            provider: "sciverse",
            docId,
            sliceCount: slices.length,
            offsets: slices.map((slice) => slice.locator.offset),
            retrievalMethod: "sciverse.semantic_search+sciverse.read",
          },
        };
      }
    }

    // 无全文访问权限或语义检索不可用：安全降级为摘要级元数据证据，不构造虚假全文。
    const abstract = stringValue(metadata.abstractPreview);
    if (!abstract) return null;
    return {
      candidate,
      title: candidate.title,
      content: abstract,
      excerpt: abstract.replace(/\s+/g, " ").trim().slice(0, 800),
      locator: { kind: "sciverse", docId, uniqueId, doi, url: candidate.url },
      sourceVersion,
      metadata: baseMetadata,
      evidenceType: "direct_quote",
      snapshotScope: {
        type: "metadata_only",
        provider: "sciverse",
        docId,
        uniqueId,
        retrievalMethod: "sciverse.search",
      },
    };
  }

  return {
    async search(context, question) {
      const candidates = new Map<string, ResearchCandidate>();
      const web = await runTool(context, "web.search", { query: question, maxResults: 5 });
      const webSources = Array.isArray(web?.sources) ? web.sources : [];
      for (const item of webSources) {
        if (!item || typeof item !== "object") continue;
        const url = typeof item.url === "string" ? item.url : null;
        if (!url) continue;
        const title = typeof item.title === "string" ? item.title : url;
        candidates.set(`web:${url}`, { provider: "web", kind: "web", externalId: url, title, url, metadata: {} });
      }

      const arxiv = await runTool(context, "arxiv.search", { query: question, maxResults: 5 });
      const arxivResults = Array.isArray(arxiv?.results) ? arxiv.results : [];
      for (const item of arxivResults) {
        if (!item || typeof item !== "object") continue;
        const value = item as Record<string, unknown>;
        const arxivId = typeof value.arxivId === "string" ? value.arxivId : null;
        if (!arxivId) continue;
        const url = typeof value.url === "string" ? value.url : `https://arxiv.org/abs/${arxivId}`;
        candidates.set(`arxiv:${arxivId}`, {
          provider: "arxiv",
          kind: "arxiv",
          externalId: arxivId,
          title: typeof value.title === "string" ? value.title : arxivId,
          url,
          metadata: { authors: value.authors, year: value.year, abstract: value.abstract, category: value.category },
        });
      }

      if (context.projectId) {
        const rag = await runTool(context, "project_rag.search", { projectId: context.projectId, query: question, maxResults: 5 });
        const hits = Array.isArray(rag?.hits) ? rag.hits : [];
        for (const item of hits) {
          if (!item || typeof item !== "object") continue;
          const value = item as Record<string, unknown>;
          const fileId = typeof value.fileId === "string" ? value.fileId : null;
          if (!fileId) continue;
          candidates.set(`project:${fileId}`, {
            provider: "project",
            kind: "project_file",
            externalId: fileId,
            title: typeof value.file === "string" ? value.file : fileId,
            url: null,
            metadata: { snippet: value.snippet, score: value.score },
          });
        }
      }
      for (const result of await searchAcademic(context, question)) {
        candidates.set(`${result.provider}:${result.externalId}`, result);
      }
      return [...candidates.values()];
    },

    async read(context, candidate) {
      if (candidate.provider === "sciverse") {
        return readSciverseCandidate(context, candidate);
      }
      const academicAdapter = academicAdapters.find((adapter) => adapter.provider === candidate.provider);
      if (academicAdapter && candidate.kind !== "web" && candidate.kind !== "arxiv" && candidate.kind !== "project_file") {
        return academicAdapter.read(context, candidate);
      }
      const toolId = candidate.kind === "web"
        ? "web.fetch"
        : candidate.kind === "arxiv"
          ? "arxiv.fetch"
          : "project_files.read";
      const args = candidate.kind === "project_file"
        ? { projectId: context.projectId, fileId: candidate.externalId, maxChars: 12_000, offset: 0 }
        : candidate.kind === "arxiv"
          ? { url: candidate.url ?? `https://arxiv.org/abs/${candidate.externalId}` }
          : { url: candidate.url };
      const result = await runTool(context, toolId, args);
      if (!result) return null;
      const content = candidate.kind === "project_file"
        ? typeof result.text === "string" ? result.text : ""
        : candidate.kind === "arxiv"
          ? typeof result.markdown === "string" ? result.markdown : typeof result.text === "string" ? result.text : ""
          : typeof result.markdown === "string" ? result.markdown : typeof result.text === "string" ? result.text : "";
      if (!content.trim()) return null;
      return {
        candidate,
        title: typeof result.title === "string" ? result.title : candidate.title,
        content,
        excerpt: content.replace(/\s+/g, " ").trim().slice(0, 800),
        locator: candidate.kind === "project_file" ? { kind: "file", fileId: candidate.externalId, offset: result.offset ?? 0 } : { kind: "url", url: candidate.url, provider: candidate.provider },
        sourceVersion: candidate.kind === "arxiv" && typeof result.year === "number" ? String(result.year) : null,
        metadata: result,
      };
    },
  };
}
