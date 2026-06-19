/**
 * Vector store — DocumentChunk CRUD and similarity search.
 * Uses pgvector <-> distance operator via Prisma raw queries.
 *
 * MVP: chunk text only, no embedding. Embedding field is reserved for later.
 */

import { prisma } from "@/lib/db";
import crypto from "crypto";
import { createTextMessage } from "@/lib/deepseek";
import { getProviderApiKey } from "@/lib/data/provider-access";
import {
  matchProjectIndex,
  refreshProjectIndex,
} from "@/lib/rag/project-index";

// ============================================================
// Configuration
// ============================================================

/** Embedding dimensions — Aliyun Bailian text-embedding-v4 default */
export const EMBEDDING_DIM = 1024;

/** Default chunk size in characters */
const CHUNK_SIZE = 1500;

/** Overlap between consecutive chunks in characters */
const CHUNK_OVERLAP = 150;

/** Small-file direct full-text loading limit, measured in characters. */
export const FULL_DOCUMENT_CHAR_LIMIT = 8000;

const DEFAULT_RETRIEVAL_LIMIT = 10;
const AGENTIC_FILE_SCOPE_LIMIT = 12;

// ============================================================
// Types
// ============================================================

export interface CreateChunksParams {
  fileAssetId: string;
  projectId: string | null;
  userId: string;
  textContent: string;
  title?: string;
}

export interface SearchParams {
  userId: string;
  projectId?: string;
  /** Query embedding vector (if available) */
  queryEmbedding?: number[];
  fileAssetIds?: string[];
  limit?: number;
}

export interface ChunkSearchResult {
  id: string;
  content: string;
  title: string | null;
  fileAssetId: string | null;
  projectId: string | null;
  chunkIndex: number;
  distance: number;
}

export interface KeywordChunkResult {
  id: string;
  content: string;
  title: string | null;
  fileAssetId: string | null;
  projectId: string | null;
  chunkIndex: number;
  originalName: string | null;
}

export interface RetrieveProjectContextParams {
  userId: string;
  projectId: string;
  selectedFileIds: string[];
  query: string;
  maxChars: number;
  loadQueryEmbedding?: () => Promise<number[] | undefined>;
}

export type ContextRetrievalStrategy =
  | "no_context"
  | "full_document"
  | "keyword_search"
  | "hybrid_search";

export interface ContextRetrievalDebug {
  strategy: ContextRetrievalStrategy;
  path: string;
  scopeSource: "none" | "selected_files" | "agentic_file_scope" | "project";
  candidateFileCount: number;
  matchedChunkCount: number;
  generatedQueryEmbedding: boolean;
  fullDocumentChars: number;
  finalContextChars: number;
  truncated: boolean;
}

export interface RetrievedProjectContext {
  context: string;
  notice: string | null;
  usedFileIds: string[];
  truncated: boolean;
  debug: ContextRetrievalDebug;
}

interface ContextSection {
  key: string;
  fileAssetId: string;
  markdown: string;
  kind: "chunk" | "full";
}

interface ContextFile {
  id: string;
  originalName: string;
  mimeType: string;
  status: string;
  textContent: string | null;
  enhancedContent: string | null;
  enhancementStatus: string;
  processingMetadata: unknown;
}

function debugPayload(
  overrides: Partial<ContextRetrievalDebug>
): ContextRetrievalDebug {
  const strategy = overrides.strategy ?? "no_context";
  const scopeSource = overrides.scopeSource ?? "none";
  return {
    strategy,
    path:
      overrides.path ??
      (scopeSource === "agentic_file_scope"
        ? `agentic_file_scope + ${strategy}`
        : strategy),
    scopeSource,
    candidateFileCount: overrides.candidateFileCount ?? 0,
    matchedChunkCount: overrides.matchedChunkCount ?? 0,
    generatedQueryEmbedding: overrides.generatedQueryEmbedding ?? false,
    fullDocumentChars: overrides.fullDocumentChars ?? 0,
    finalContextChars: overrides.finalContextChars ?? 0,
    truncated: overrides.truncated ?? false,
  };
}

function hasAnyPattern(query: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(query));
}

const PROJECT_CONTEXT_PATTERNS = [
  /根据.*(资料|文件|文档|课件|笔记|项目|报告|材料)/,
  /(项目资料|上传的?文件|选中.*文件|这些资料|课程资料|实验报告|资料库)/,
  /(文件|文档|课件|笔记|资料|材料|报告).*(说明|回答|查找|定位|总结|比较|分析)/,
];

const FULL_DOCUMENT_PATTERNS = [
  /(总结|摘要|翻译|改写|润色).*(全文|整份|整篇|整个|文件|文档|资料|报告)/,
  /(全文|整份|整篇|整个).*(总结|摘要|翻译|改写|润色|检查|分析|梳理)/,
  /(通读|阅读全文|检查全文|按全文|完整阅读)/,
];

const CROSS_DOCUMENT_PATTERNS = [
  /(比较|对比|差异|共同点|联系|关联|综合|归纳|整合)/,
  /(跨文档|多个文件|多份|两份|所有资料|项目资料)/,
];

const EXACT_QUERY_PATTERNS = [
  /第\s*[0-9一二三四五六七八九十]+\s*[章节讲]/,
  /chapter\s*\d+/i,
  /\b[A-Z][A-Z0-9_+-]{1,}\b/,
  /\b[a-zA-Z_$][\w$]*\s*\(/,
  /[`"“”'‘’][^`"“”'‘’]{2,}[`"“”'‘’]/,
];

export function shouldUseProjectContext(
  query: string,
  selectedFileIds: string[] = []
) {
  if (selectedFileIds.length > 0) return true;
  return hasAnyPattern(query, PROJECT_CONTEXT_PATTERNS);
}

function isWholeDocumentTask(query: string) {
  return hasAnyPattern(query, FULL_DOCUMENT_PATTERNS);
}

function shouldUseHybridSearch(query: string, candidateFileCount: number) {
  if (candidateFileCount > 1) return true;
  return hasAnyPattern(query, CROSS_DOCUMENT_PATTERNS);
}

function isExplicitKeywordQuery(query: string) {
  return hasAnyPattern(query, EXACT_QUERY_PATTERNS);
}

// ============================================================
// Text splitting
// ============================================================

/**
 * Split text into overlapping chunks by character count.
 * Tries to break at paragraph boundaries within the limit.
 */
function splitTextIntoChunks(text: string, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  if (!text || text.trim().length === 0) return [];

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = start + size;
    if (end >= text.length) {
      chunks.push(text.slice(start).trim());
      break;
    }

    // Try to break at a paragraph boundary (double newline or period+newline)
    const searchRegion = text.slice(end - overlap, end);
    const lastPara = searchRegion.lastIndexOf("\n\n");
    const lastPeriod = searchRegion.lastIndexOf("。\n");

    let breakPoint = -1;
    if (lastPara !== -1) breakPoint = end - overlap + lastPara + 2;
    else if (lastPeriod !== -1) breakPoint = end - overlap + lastPeriod + 1;

    if (breakPoint !== -1 && breakPoint > start) {
      end = breakPoint;
    }

    chunks.push(text.slice(start, end).trim());
    start = end - overlap;
    if (start < 0) start = 0;
  }

  return chunks.filter((c) => c.length > 0);
}

// ============================================================
// Chunk CRUD
// ============================================================

/**
 * Split text content into chunks and insert into DocumentChunk table.
 * Deletes existing chunks for the same fileAssetId first.
 * MVP: no embedding — only stores content.
 */
export async function createDocumentChunks(params: CreateChunksParams): Promise<number> {
  const { fileAssetId, projectId, userId, textContent, title } = params;

  // Delete existing chunks for this file
  await prisma.documentChunk.deleteMany({
    where: { fileAssetId, userId },
  });

  const texts = splitTextIntoChunks(textContent);
  if (texts.length === 0) return 0;

  const contentHash = crypto
    .createHash("sha256")
    .update(textContent)
    .digest("hex")
    .slice(0, 32);

  // Batch insert
  const data = texts.map((content, i) => ({
    userId,
    projectId,
    fileAssetId,
    title: title || null,
    content,
    contentHash,
    chunkIndex: i,
    tokenCount: Math.ceil(content.length / 2), // rough estimate: ~2 chars per token
  }));

  await prisma.documentChunk.createMany({ data });

  return texts.length;
}

/**
 * Search similar chunks by embedding vector using pgvector <-> operator.
 * Returns empty array if queryEmbedding is not provided (MVP).
 * Results are scoped by userId.
 */
export async function searchSimilarChunks(
  params: SearchParams
): Promise<ChunkSearchResult[]> {
  const { userId, projectId, queryEmbedding, fileAssetIds, limit = 10 } = params;

  // MVP: no embedding → return empty
  if (!queryEmbedding || queryEmbedding.length !== EMBEDDING_DIM) {
    return [];
  }

  const vectorStr = `[${queryEmbedding.join(",")}]`;

  const projectFilter = projectId
    ? `AND "projectId" = '${projectId}'`
    : "";
  const fileFilter = fileAssetIds?.length
    ? `AND "fileAssetId" = ANY($4)`
    : "";

  // Use raw SQL for pgvector distance operator
  const sql = `SELECT
    id, content, title, "fileAssetId", "projectId", "chunkIndex",
    embedding <-> $1::vector AS distance
  FROM "DocumentChunk"
  WHERE "userId" = $2
    AND embedding IS NOT NULL
    ${projectFilter}
    ${fileFilter}
  ORDER BY embedding <-> $1::vector
  LIMIT $3`;
  const args = fileAssetIds?.length
    ? [vectorStr, userId, limit, fileAssetIds]
    : [vectorStr, userId, limit];
  const rows = await prisma.$queryRawUnsafe<ChunkSearchResult[]>(
    sql,
    ...args
  );

  return rows || [];
}

function extractKeywords(query: string): string[] {
  const runs = query
    .toLowerCase()
    .match(/[\p{Script=Han}a-z0-9_+-]{2,}/gu) || [];
  const terms = new Set<string>();

  for (const run of runs) {
    if (run.length <= 8) {
      terms.add(run);
    } else {
      terms.add(run.slice(0, 8));
      if (/^\p{Script=Han}+$/u.test(run)) {
        for (let i = 0; i < run.length - 1 && terms.size < 20; i += 2) {
          terms.add(run.slice(i, i + 2));
        }
      }
    }
    if (terms.size >= 20) break;
  }

  return [...terms];
}

function extractJsonFileIds(value: string): string[] {
  const fenced = value.match(/```json\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced || value.match(/\[[\s\S]*\]/)?.[0] || value;
  const parsed = JSON.parse(candidate) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        return typeof record.id === "string" ? record.id : null;
      }
      return null;
    })
    .filter((id): id is string => Boolean(id));
}

export async function selectFilesWithDeepSeek(params: {
  userId: string;
  projectId: string;
  query: string;
  limit?: number;
}): Promise<{ fileIds: string[]; source: "agentic-retrieval" | "index-fallback" }> {
  const limit = params.limit ?? 12;
  const fallback = async () => {
    const result = await matchProjectIndex({
      userId: params.userId,
      projectId: params.projectId,
      query: params.query,
      limit,
    });
    return {
      fileIds: result.fullLoadFileIds,
      source: "index-fallback" as const,
    };
  };

  let apiKey: string;
  try {
    apiKey = await getProviderApiKey(params.userId, "deepseek");
  } catch {
    return fallback();
  }

  let projectIndex = await prisma.projectIndex.findUnique({
    where: { projectId: params.projectId },
    select: { content: true },
  });
  if (!projectIndex?.content) {
    const content = await refreshProjectIndex({
      userId: params.userId,
      projectId: params.projectId,
    });
    projectIndex = { content };
  }

  const validFiles = await prisma.fileAsset.findMany({
    where: {
      userId: params.userId,
      projectId: params.projectId,
      status: { in: ["parsed", "partial"] },
    },
    select: { id: true },
  });
  const validIds = new Set(validFiles.map((file) => file.id));

  try {
    const output = await createTextMessage(apiKey, {
      model: "deepseek-v4-flash",
      maxTokens: 1200,
      temperature: 0,
      system:
        "你是课程项目资料检索器。根据 INDEX.md 只选择与问题直接相关的文件。只能输出 JSON 数组。",
      prompt: [
        "从下面 INDEX.md 中选出最相关的文件 ID。",
        `最多选择 ${limit} 个。不要选择无关文件。`,
        "输出格式：[{\"id\":\"file_id\"}]",
        "",
        "# 用户问题",
        params.query,
        "",
        "# INDEX.md",
        projectIndex.content,
      ].join("\n"),
    });
    const fileIds = [...new Set(extractJsonFileIds(output))]
      .filter((id) => validIds.has(id))
      .slice(0, limit);
    if (fileIds.length === 0) return fallback();
    return { fileIds, source: "agentic-retrieval" };
  } catch {
    return fallback();
  }
}

export async function searchChunksByKeyword(params: {
  userId: string;
  projectId: string;
  query: string;
  fileAssetIds?: string[];
  limit?: number;
}): Promise<KeywordChunkResult[]> {
  const keywords = extractKeywords(params.query);
  if (keywords.length === 0) return [];

  const rows = await prisma.documentChunk.findMany({
    where: {
      userId: params.userId,
      projectId: params.projectId,
      ...(params.fileAssetIds?.length
        ? { fileAssetId: { in: params.fileAssetIds } }
        : {}),
      OR: keywords.map((keyword) => ({
        content: { contains: keyword, mode: "insensitive" as const },
      })),
    },
    orderBy: [{ fileAssetId: "asc" }, { chunkIndex: "asc" }],
    take: params.limit || 12,
    select: {
      id: true,
      content: true,
      title: true,
      fileAssetId: true,
      projectId: true,
      chunkIndex: true,
      fileAsset: { select: { originalName: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    content: row.content,
    title: row.title,
    fileAssetId: row.fileAssetId,
    projectId: row.projectId,
    chunkIndex: row.chunkIndex,
    originalName: row.fileAsset?.originalName || row.title,
  }));
}

export async function hybridSearch(params: {
  userId: string;
  projectId: string;
  query: string;
  queryEmbedding?: number[];
  fileAssetIds?: string[];
  limit?: number;
}): Promise<KeywordChunkResult[]> {
  const limit = params.limit ?? 10;
  const [vectorResults, keywordResults] = await Promise.all([
    params.queryEmbedding
      ? searchSimilarChunks({
          userId: params.userId,
          projectId: params.projectId,
          queryEmbedding: params.queryEmbedding,
          fileAssetIds: params.fileAssetIds,
          limit: limit * 2,
        })
      : Promise.resolve([]),
    searchChunksByKeyword({
      userId: params.userId,
      projectId: params.projectId,
      query: params.query,
      fileAssetIds: params.fileAssetIds,
      limit: limit * 2,
    }),
  ]);

  const scores = new Map<string, number>();
  const k = 60;
  for (const [rank, chunk] of vectorResults.entries()) {
    scores.set(chunk.id, (scores.get(chunk.id) || 0) + 1 / (k + rank + 1));
  }
  for (const [rank, chunk] of keywordResults.entries()) {
    scores.set(chunk.id, (scores.get(chunk.id) || 0) + 1 / (k + rank + 1));
  }

  const sortedIds = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => id);
  if (sortedIds.length === 0) return [];

  const chunks = await prisma.documentChunk.findMany({
    where: { id: { in: sortedIds }, userId: params.userId },
    select: {
      id: true,
      content: true,
      title: true,
      fileAssetId: true,
      projectId: true,
      chunkIndex: true,
      fileAsset: { select: { originalName: true } },
    },
  });
  const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]));

  return sortedIds.flatMap((id) => {
    const chunk = byId.get(id);
    if (!chunk) return [];
    return [{
      id: chunk.id,
      content: chunk.content,
      title: chunk.title,
      fileAssetId: chunk.fileAssetId,
      projectId: chunk.projectId,
      chunkIndex: chunk.chunkIndex,
      originalName: chunk.fileAsset?.originalName || chunk.title,
    }];
  });
}

function parserNotice(file: {
  mimeType: string;
  processingMetadata: unknown;
  enhancedContent: string | null;
  enhancementStatus: string;
}) {
  if (file.enhancedContent && file.enhancementStatus === "enhanced") {
    return "以下内容为基于 OCR 原文整理的增强资料，原始 OCR 可能存在识别误差。";
  }

  const metadata =
    file.processingMetadata && typeof file.processingMetadata === "object"
      ? (file.processingMetadata as Record<string, unknown>)
      : {};
  if (metadata.parser === "pdf-text") {
    return "以下内容来自 PDF 文本提取，可能存在页码顺序或格式丢失。";
  }
  if (
    metadata.parser === "minimax-pdf-vision" ||
    file.mimeType.startsWith("image/")
  ) {
    return "以下内容来自图片 OCR/视觉解析，可能存在识别误差。涉及数字、公式和单位时请提醒用户核对。";
  }
  return "以下资料来自用户选中文件或关键词检索。";
}

export async function retrieveProjectContext(
  params: RetrieveProjectContextParams
): Promise<RetrievedProjectContext> {
  const sections: ContextSection[] = [];
  const seen = new Set<string>();
  const selectedFileIds = [...new Set(params.selectedFileIds)];
  let contextFileIds = selectedFileIds;
  let scopeSource: ContextRetrievalDebug["scopeSource"] =
    selectedFileIds.length > 0 ? "selected_files" : "project";
  let candidateFiles: ContextFile[] = [];

  if (!shouldUseProjectContext(params.query, selectedFileIds)) {
    const debug = debugPayload({ strategy: "no_context" });
    return {
      context: "",
      notice: "未找到可用于回答的项目资料。",
      usedFileIds: [],
      truncated: false,
      debug,
    };
  }

  if (contextFileIds.length === 0) {
    try {
      const selection = await selectFilesWithDeepSeek({
        userId: params.userId,
        projectId: params.projectId,
        query: params.query,
        limit: AGENTIC_FILE_SCOPE_LIMIT,
      });
      contextFileIds = selection.fileIds;
      if (contextFileIds.length > 0) {
        scopeSource = "agentic_file_scope";
      }
    } catch {
      contextFileIds = [];
    }
  }

  if (contextFileIds.length > 0) {
    const fileOrder = new Map(contextFileIds.map((id, index) => [id, index]));
    const files = await prisma.fileAsset.findMany({
      where: {
        id: { in: contextFileIds },
        userId: params.userId,
        projectId: params.projectId,
      },
      select: {
        id: true,
        originalName: true,
        mimeType: true,
        status: true,
        textContent: true,
        enhancedContent: true,
        enhancementStatus: true,
        processingMetadata: true,
      },
    });

    candidateFiles = files.sort(
      (a, b) => (fileOrder.get(a.id) ?? 0) - (fileOrder.get(b.id) ?? 0)
    );
  }

  const parsedCandidateFiles = candidateFiles.filter((file) => {
    const content = file.enhancementStatus === "enhanced" && file.enhancedContent
      ? file.enhancedContent
      : file.textContent;
    return Boolean(content) && ["parsed", "partial"].includes(file.status);
  });
  const candidateFileIds = parsedCandidateFiles.map((file) => file.id);
  const hasFileScope = contextFileIds.length > 0;
  const scopedFileIds = hasFileScope ? candidateFileIds : undefined;
  const candidateFileCount = contextFileIds.length > 0
    ? candidateFileIds.length
    : 0;
  const selectedFullDocumentChars = parsedCandidateFiles.reduce(
    (total, file) => {
      const content = file.enhancementStatus === "enhanced" && file.enhancedContent
        ? file.enhancedContent
        : file.textContent;
      return total + (content?.length ?? 0);
    },
    0
  );
  const canLoadFullDocument =
    selectedFileIds.length > 0 &&
    isWholeDocumentTask(params.query) &&
    !shouldUseHybridSearch(params.query, candidateFileIds.length) &&
    selectedFullDocumentChars > 0 &&
    selectedFullDocumentChars <= FULL_DOCUMENT_CHAR_LIMIT;

  let strategy: ContextRetrievalStrategy = "keyword_search";
  if (canLoadFullDocument) {
    strategy = "full_document";
  } else if (
    !isExplicitKeywordQuery(params.query) &&
    shouldUseHybridSearch(params.query, candidateFileIds.length || 1)
  ) {
    strategy = "hybrid_search";
  }

  let generatedQueryEmbedding = false;
  let matchedChunkCount = 0;
  let fullDocumentChars = 0;

  const chunkCount = strategy === "full_document" ||
    (hasFileScope && candidateFileIds.length === 0)
    ? 0
    : await prisma.documentChunk.count({
        where: {
          userId: params.userId,
          projectId: params.projectId,
          ...(scopedFileIds?.length ? { fileAssetId: { in: scopedFileIds } } : {}),
        },
      });

  if (strategy !== "full_document" && chunkCount > 0) {
    let chunks: KeywordChunkResult[] = [];
    if (strategy === "hybrid_search") {
      const queryEmbedding = await params.loadQueryEmbedding?.();
      generatedQueryEmbedding = Boolean(queryEmbedding?.length);
      chunks = await hybridSearch({
        userId: params.userId,
        projectId: params.projectId,
        query: params.query,
        queryEmbedding,
        fileAssetIds: scopedFileIds,
        limit: DEFAULT_RETRIEVAL_LIMIT,
      });
    } else {
      chunks = await searchChunksByKeyword({
        userId: params.userId,
        projectId: params.projectId,
        query: params.query,
        fileAssetIds: scopedFileIds,
        limit: DEFAULT_RETRIEVAL_LIMIT,
      });
    }

    matchedChunkCount = chunks.length;
    for (const chunk of chunks) {
      const key = `${chunk.fileAssetId || "none"}:${chunk.chunkIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);
      sections.push({
        key,
        kind: "chunk",
        fileAssetId: chunk.fileAssetId || "",
        markdown: `## 来源：${chunk.originalName || chunk.title || "项目资料"}（chunk ${chunk.chunkIndex + 1}）\n\n> 以下资料来自用户选中文件或项目资料检索。\n\n${chunk.content}`,
      });
    }
  }

  if (strategy === "full_document" || sections.length === 0) {
    const allowSmallFullFallback =
      strategy === "full_document" ||
      (selectedFileIds.length > 0 &&
        selectedFullDocumentChars > 0 &&
        selectedFullDocumentChars <= FULL_DOCUMENT_CHAR_LIMIT);

    if (allowSmallFullFallback) {
      for (const file of parsedCandidateFiles) {
        const content =
          file.enhancementStatus === "enhanced" && file.enhancedContent
            ? file.enhancedContent
            : file.textContent;
        if (!content) continue;
        const key = `${file.id}:enhanced-or-full`;
        if (seen.has(key)) continue;
        seen.add(key);
        fullDocumentChars += content.length;
        sections.push({
          key,
          kind: "full",
          fileAssetId: file.id,
          markdown: `## 来源：${file.originalName}\n\n> ${parserNotice(file)}\n\n${content}`,
        });
      }
    }
  }

  if (strategy === "full_document") {
    fullDocumentChars = selectedFullDocumentChars;
  }

  if (
    sections.length === 0 &&
    strategy === "hybrid_search" &&
    generatedQueryEmbedding
  ) {
    const keywordChunks = await searchChunksByKeyword({
      userId: params.userId,
      projectId: params.projectId,
      query: params.query,
      fileAssetIds: scopedFileIds,
      limit: DEFAULT_RETRIEVAL_LIMIT,
    });

    for (const chunk of keywordChunks) {
      const key = `${chunk.fileAssetId || "none"}:${chunk.chunkIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);
      sections.push({
        key,
        kind: "chunk",
        fileAssetId: chunk.fileAssetId || "",
        markdown: `## 来源：${chunk.originalName || chunk.title || "项目资料"}（chunk ${chunk.chunkIndex + 1}）\n\n> 以下资料来自用户选中文件或项目资料检索。\n\n${chunk.content}`,
      });
    }
    matchedChunkCount = keywordChunks.length;
  }

  if (sections.length === 0) {
    const debug = debugPayload({
      strategy,
      scopeSource,
      candidateFileCount,
      matchedChunkCount,
      generatedQueryEmbedding,
    });
    return {
      context: "",
      notice: "未找到可用于回答的项目资料。",
      usedFileIds: [],
      truncated: false,
      debug,
    };
  }

  let context = "";
  let truncated = false;
  for (const section of sections) {
    const separator = context ? "\n\n---\n\n" : "";
    const remaining = params.maxChars - context.length - separator.length;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    if (section.markdown.length > remaining) {
      context += `${separator}${section.markdown.slice(0, remaining)}`;
      truncated = true;
      break;
    }
    context += `${separator}${section.markdown}`;
  }

  return {
    context,
    notice: null,
    usedFileIds: [...new Set(sections.map((section) => section.fileAssetId).filter(Boolean))],
    truncated,
    debug: debugPayload({
      strategy,
      scopeSource,
      candidateFileCount,
      matchedChunkCount,
      generatedQueryEmbedding,
      fullDocumentChars,
      finalContextChars: context.length,
      truncated,
    }),
  };
}

/**
 * Delete all chunks for a file asset. Verifies userId ownership.
 */
export async function deleteChunksByFileAsset(
  fileAssetId: string,
  userId: string
): Promise<number> {
  const result = await prisma.documentChunk.deleteMany({
    where: { fileAssetId, userId },
  });
  return result.count;
}

/**
 * Get all chunks for a file asset (no embedding needed).
 */
export async function getChunksByFileAsset(
  fileAssetId: string,
  userId: string
) {
  return prisma.documentChunk.findMany({
    where: { fileAssetId, userId },
    orderBy: { chunkIndex: "asc" },
    select: {
      id: true,
      content: true,
      chunkIndex: true,
      tokenCount: true,
    },
  });
}
