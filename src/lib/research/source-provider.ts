import { createHash, randomUUID } from "node:crypto";
import { createPrismaToolRunner } from "@/lib/agent/tools/tool-runner";
import type { ToolRunner } from "@/lib/agent/tools/tool-runner";
import { createAcademicSourceAdapters, type AcademicSourceAdapter } from "./academic-adapters";
import { normalizeDoi } from "./source-identity";
import { deriveScholarlyFilterIntent } from "./scholarly-filter";

/** 一次 Sciverse 检索实际生效的 advanced filter provenance（有界）。 */
export interface ScholarlyFilterRecord {
  question: string;
  catalog: string;
  applied: string[];
  dropped: string[];
  relaxedRetry: boolean;
  signals: string[];
}

export interface ResearchProviderContext {
  userId: string;
  conversationId: string;
  executionId: string;
  runId: string;
  projectId?: string | null;
  signal: AbortSignal;
  /** 当前 Research Question 原文；Sciverse 语义证据检索按问题取 chunk。 */
  question?: string;
  /** 领域 profile key 与预算档位：只影响 deterministic filter intent 的推导。 */
  domainProfileKey?: string | null;
  budgetProfile?: "quick" | "deep" | "comprehensive";
  /** Research Plan 的时间范围文字。 */
  planTimeRange?: string | null;
  /** 记录本 Run 内 Sciverse advanced filter 的生效情况（诊断与指标用）。 */
  recordScholarlyFilter?: (record: ScholarlyFilterRecord) => void;
  /**
   * 记录可向用户解释的 provider 降级（稳定代码，见 RESEARCH_DEGRADATION_MESSAGES）。
   * 只记录「本应可用但失败/为空」的情况，不把正常空结果当成故障。
   */
  recordDegradation?: (code: string) => void;
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
/** 每条 slice 最多记录的图表引用数量（有界，避免正文里的图片列表无限增长）。 */
const SCIVERSE_SLICE_MAX_RESOURCE_REFS = 4;

/** slice provenance 中的图表引用（来自 sciverse.read 的确定性解析结果）。 */
export interface ResearchResourceRef {
  fileName: string;
  kind: "figure" | "table" | "image";
  alt?: string;
  context?: string;
}

/**
 * 只接受 sciverse.read 归一化后的资源引用形状：相对路径 + 受限 kind。
 * 任何不符合契约的条目直接丢弃，绝不把任意 URL/路径带进 Evidence。
 */
export function parseResearchResourceRefs(value: unknown): ResearchResourceRef[] {
  if (!Array.isArray(value)) return [];
  const refs: ResearchResourceRef[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const record = raw as Record<string, unknown>;
    const fileName = stringValue(record.fileName);
    if (!fileName || seen.has(fileName)) continue;
    if (fileName.startsWith("/") || fileName.includes("\\") || fileName.split("/").some((segment) => segment === ".." || segment === "." || segment === "")) continue;
    if (/^[a-z][a-z0-9+.-]*:/i.test(fileName)) continue;
    // 上游真实资源路径至少包含一段目录前缀；没有 `/` 的名字不是资源引用。
    if (!fileName.includes("/")) continue;
    seen.add(fileName);
    const kind = record.kind === "figure" || record.kind === "table" ? record.kind : "image";
    const alt = stringValue(record.alt);
    const context = stringValue(record.context);
    refs.push({
      fileName,
      kind,
      ...(alt ? { alt: alt.slice(0, 200) } : {}),
      ...(context ? { context: context.slice(0, 500) } : {}),
    });
    if (refs.length >= SCIVERSE_SLICE_MAX_RESOURCE_REFS) break;
  }
  return refs;
}

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

/**
 * Research 系统编排方的统一工具调用入口：不带 skillId（Research durable Run
 * 没有人工审批通道，skillId 会触发 user-facing Skill 的 ask_first 审批策略，
 * 导致工具调用 pending_approval 并静默回退——289690f 修复的回归点）。
 * 工具面由 durable checkpoint allowedToolIds 与 registry L1 auto 策略约束。
 */
export type ResearchToolInvoker = (
  context: ResearchProviderContext,
  toolId: string,
  args: Record<string, unknown>,
) => Promise<Record<string, unknown> | null>;

export function createResearchToolInvoker(toolRunner?: ToolRunner): ResearchToolInvoker {
  const runner = toolRunner ?? createPrismaToolRunner();
  return async (context, toolId, args) => {
    const result = await runner.run(
      {
        call: { id: randomUUID(), toolId, arguments: args },
        context: {
          userId: context.userId,
          conversationId: context.conversationId,
          projectId: context.projectId ?? undefined,
          runId: context.runId,
          agentExecutionId: context.executionId,
          signal: context.signal,
          sessionApprovals: new Map(),
        },
      },
      () => undefined
    );
    return result.status === "succeeded" ? (result.summary ?? null) : null;
  };
}

export function createToolBackedResearchSourceProvider(input: { toolRunner?: ToolRunner; academicAdapters?: AcademicSourceAdapter[] } = {}): ResearchSourceProvider {
  const academicAdapters = input.academicAdapters ?? createAcademicSourceAdapters();
  const runTool = createResearchToolInvoker(input.toolRunner);

  async function searchAcademic(context: ResearchProviderContext, question: string): Promise<ResearchCandidate[]> {
    // Sciverse 是学术检索主通道：返回有效结果时不再 fan-out 到 legacy adapters；
    // 未配置 / 明确不可用 / 空结果时才回退 OpenAlex/Crossref/Semantic Scholar/PubMed。
    //
    // 结构化收敛只走「高层 filter intent + 计划时间范围」：具体字段与操作符由
    // sciverse.search 的 catalog compiler 决定，Research 不构造 wire filter。
    const derived = deriveScholarlyFilterIntent({
      question,
      domainProfileKey: context.domainProfileKey,
      budgetProfile: context.budgetProfile ?? "quick",
      planTimeRange: context.planTimeRange ?? null,
    });
    const sciverse = await runTool(context, "sciverse.search", {
      query: question,
      pageSize: SCIVERSE_SEARCH_PAGE_SIZE,
      ...(derived && Object.keys(derived.intent).length > 0 ? { filterIntent: derived.intent } : {}),
      ...(derived?.yearFrom !== undefined ? { yearFrom: derived.yearFrom } : {}),
      ...(derived?.yearTo !== undefined ? { yearTo: derived.yearTo } : {}),
    });
    if (sciverse && typeof sciverse === "object" && !("error" in sciverse)) {
      const payload = sciverse as Record<string, unknown>;
      if (derived) {
        const provenance = payload.advancedFilters && typeof payload.advancedFilters === "object" && !Array.isArray(payload.advancedFilters)
          ? payload.advancedFilters as Record<string, unknown>
          : {};
        const applied = Array.isArray(provenance.applied)
          ? provenance.applied.flatMap((entry) => {
              if (!entry || typeof entry !== "object") return [];
              const key = (entry as Record<string, unknown>).key;
              return typeof key === "string" ? [key] : [];
            })
          : [];
        const dropped = Array.isArray(provenance.dropped)
          ? provenance.dropped.flatMap((entry) => {
              if (!entry || typeof entry !== "object") return [];
              const record = entry as Record<string, unknown>;
              return typeof record.key === "string" && typeof record.reason === "string"
                ? [`${record.key}:${record.reason}`]
                : [];
            })
          : [];
        context.recordScholarlyFilter?.({
          question,
          catalog: typeof provenance.catalog === "string" ? provenance.catalog : "unavailable",
          applied,
          dropped,
          relaxedRetry: provenance.relaxedRetry === true,
          signals: derived.signals,
        });
        if (typeof provenance.catalog === "string" && provenance.catalog === "unavailable" && Object.keys(derived.intent).length > 0) {
          context.recordDegradation?.("sciverse_catalog_unavailable");
        } else if (dropped.length > 0) {
          context.recordDegradation?.("sciverse_filters_dropped");
        }
      }
      const papers = Array.isArray(payload.papers) ? payload.papers as unknown[] : [];
      const mapped = papers.flatMap((paper) => {
        if (!paper || typeof paper !== "object") return [];
        const candidate = sciverseCandidate(paper as Record<string, unknown>);
        return candidate ? [candidate] : [];
      });
      if (mapped.length > 0) return mapped;
      context.recordDegradation?.("sciverse_empty");
    } else if (sciverse && typeof sciverse === "object" && "error" in sciverse) {
      const code = (sciverse as Record<string, unknown>).error;
      if (code !== "SCIVERSE_NOT_CONFIGURED") context.recordDegradation?.("sciverse_error");
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
        let resourceRefs: ResearchResourceRef[] = [];
        let documentLength: number | null = null;
        const slice = await runTool(context, "sciverse.read", { docId, offset, limit: SCIVERSE_READ_LIMIT });
        if (slice && typeof slice === "object" && !("error" in slice)) {
          const sliceText = stringValue((slice as Record<string, unknown>).text);
          if (sliceText) {
            text = sliceText;
            retrievalMethod = "sciverse.read";
          }
          resourceRefs = parseResearchResourceRefs((slice as Record<string, unknown>).resources);
          documentLength = numberValue((slice as Record<string, unknown>).totalLength);
        }        if (!text) text = stringValue(hit.chunk);
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
            // 图表资源只作为「本片段内确定性发现的引用」记录，抓取与视觉分析
            // 由有预算上限的 visual_evidence 阶段决定。
            ...(resourceRefs.length > 0 ? { resourceRefs } : {}),
            // 文档总长度（Unicode 码点）：visual_evidence 用它做有界图表扫描定位。
            ...(documentLength !== null ? { documentLength } : {}),
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
      if (web && typeof web === "object" && "error" in web) context.recordDegradation?.("web_error");
      const webSources = Array.isArray(web?.sources) ? web.sources : [];
      for (const item of webSources) {
        if (!item || typeof item !== "object") continue;
        const url = typeof item.url === "string" ? item.url : null;
        if (!url) continue;
        const title = typeof item.title === "string" ? item.title : url;
        candidates.set(`web:${url}`, { provider: "web", kind: "web", externalId: url, title, url, metadata: {} });
      }

      const arxiv = await runTool(context, "arxiv.search", { query: question, maxResults: 5 });
      if (arxiv && typeof arxiv === "object" && "error" in arxiv) context.recordDegradation?.("arxiv_error");
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
