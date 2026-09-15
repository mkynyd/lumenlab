import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  CODE_EXTENSIONS,
  DOCUMENT_EXTENSIONS,
  IMAGE_EXTENSIONS,
  VIDEO_EXTENSIONS,
} from "@/lib/files/file-upload-policy";

/**
 * 跨项目文件查询：筛选、两级搜索与游标分页。
 *
 * 命中分级和排序都在 SQL 里完成（文件名完全命中 > 文件名前缀 > 文件名包含 >
 * 项目名/分类 > 正文），所以分页游标必须携带 rank：只按 updatedAt 分页会让
 * 第二页之后的顺序和第一页的排序规则对不上，出现重复或漏项。名称排序用另一
 * 套游标字段，(排序方式, 位置) 不一致时直接拒绝，不做静默降级。
 *
 * 所有查询强制限定 `userId`，调用方不需要（也不应该）再拼权限条件。
 */

export const FILE_MIME_GROUPS = [
  "document",
  "image",
  "video",
  "text",
  "data",
  "code",
] as const;
export type FileMimeGroup = (typeof FILE_MIME_GROUPS)[number];

export const FILE_QUERY_STATUSES = [
  "parsing",
  "parsed",
  "warning",
  "index-incomplete",
  "failed",
] as const;
export type FileQueryStatus = (typeof FILE_QUERY_STATUSES)[number];

export const FILE_QUERY_SORTS = ["relevance", "recent", "name"] as const;
export type FileQuerySort = (typeof FILE_QUERY_SORTS)[number];

/** 命中来源，供前端决定高亮哪一段。 */
export type FileMatchKind = "filename" | "project" | "category" | "content";

export const FILE_QUERY_DEFAULT_LIMIT = 20;
export const FILE_QUERY_MAX_LIMIT = 100;

const SNIPPET_RADIUS = 40;
const SNIPPET_LENGTH = 160;

export function isFileMimeGroup(value: unknown): value is FileMimeGroup {
  return (
    typeof value === "string" &&
    (FILE_MIME_GROUPS as readonly string[]).includes(value)
  );
}

export function isFileQueryStatus(value: unknown): value is FileQueryStatus {
  return (
    typeof value === "string" &&
    (FILE_QUERY_STATUSES as readonly string[]).includes(value)
  );
}

export function isFileQuerySort(value: unknown): value is FileQuerySort {
  return (
    typeof value === "string" && (FILE_QUERY_SORTS as readonly string[]).includes(value)
  );
}

export function normalizeFileQueryLimit(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return FILE_QUERY_DEFAULT_LIMIT;
  const floored = Math.floor(parsed);
  if (floored < 1) return FILE_QUERY_DEFAULT_LIMIT;
  return Math.min(floored, FILE_QUERY_MAX_LIMIT);
}

/** 扩展名表以 file-upload-policy 为单一来源，避免两处 MIME 映射漂移。 */
const NON_CODE_TEXT_EXTENSIONS = new Set(["txt", "md", "csv", "json"]);

function uniqueMimeTypes(values: string[]): string[] {
  return [...new Set(values)];
}

const GROUP_MIME_TYPES: Record<FileMimeGroup, string[]> = {
  document: uniqueMimeTypes(Object.values(DOCUMENT_EXTENSIONS)),
  image: uniqueMimeTypes(Object.values(IMAGE_EXTENSIONS)),
  video: uniqueMimeTypes(Object.values(VIDEO_EXTENSIONS)),
  text: [CODE_EXTENSIONS.txt, CODE_EXTENSIONS.md],
  data: [CODE_EXTENSIONS.csv, CODE_EXTENSIONS.json],
  code: uniqueMimeTypes(
    Object.entries(CODE_EXTENSIONS)
      .filter(([ext]) => !NON_CODE_TEXT_EXTENSIONS.has(ext))
      .map(([, mime]) => mime)
  ),
};

/** 「已解析但有警告」与「已解析」互斥，两者的判定都来自解析质量报告。 */
const WARNING_COUNT_SQL = Prisma.sql`COALESCE((f."processingMetadata" -> 'parseReport' ->> 'warningCount')::int, 0)`;

function statusSql(status: FileQueryStatus): Prisma.Sql {
  switch (status) {
    case "parsing":
      // 排队的文件 status 仍是 uploaded，只有开始转换才写 parsing。
      return Prisma.sql`f.status IN ('uploaded', 'parsing')`;
    case "failed":
      return Prisma.sql`f.status = 'failed'`;
    case "warning":
      return Prisma.sql`f.status = 'parsed' AND ${WARNING_COUNT_SQL} > 0`;
    case "index-incomplete":
      return Prisma.sql`f."processingMetadata" ->> 'embeddingStatus' IN ('missing', 'partial')`;
    case "parsed":
      return Prisma.sql`f.status = 'parsed' AND ${WARNING_COUNT_SQL} = 0`;
    default:
      return Prisma.sql`TRUE`;
  }
}

/**
 * 转义 LIKE 元字符，配合 SQL 里的 `ESCAPE '\'` 使用，
 * 否则用户搜「50%」或「a_b」会被当成通配符。
 */
function likePattern(value: string, position: "contains" | "prefix"): string {
  const escaped = value.replace(/[\\%_]/g, (char) => `\\${char}`);
  return position === "prefix" ? `${escaped}%` : `%${escaped}%`;
}

/** 两级搜索的匹配条件：文件名/项目名/分类，加上解析正文、分块与索引摘要。 */
function matchConditionSql(q: string): Prisma.Sql {
  const contains = likePattern(q, "contains");
  return Prisma.sql`(
    f."originalName" ILIKE ${contains} ESCAPE '\\'
    OR p.name ILIKE ${contains} ESCAPE '\\'
    OR f.category ILIKE ${contains} ESCAPE '\\'
    OR f."textContent" ILIKE ${contains} ESCAPE '\\'
    OR EXISTS (
      SELECT 1 FROM "DocumentChunk" c
      WHERE c."fileAssetId" = f.id AND c.content ILIKE ${contains} ESCAPE '\\'
    )
    OR f."processingMetadata" ->> 'summary' ILIKE ${contains} ESCAPE '\\'
    OR COALESCE(f."processingMetadata" -> 'keywords', '[]'::jsonb)::text ILIKE ${contains} ESCAPE '\\'
  )`;
}

function rankSql(q: string): Prisma.Sql {
  const prefix = likePattern(q, "prefix");
  const contains = likePattern(q, "contains");
  return Prisma.sql`CASE
    WHEN lower(f."originalName") = ${q.toLowerCase()} THEN 0
    WHEN f."originalName" ILIKE ${prefix} ESCAPE '\\' THEN 1
    WHEN f."originalName" ILIKE ${contains} ESCAPE '\\' THEN 2
    WHEN p.name ILIKE ${contains} ESCAPE '\\' OR f.category ILIKE ${contains} ESCAPE '\\' THEN 3
    ELSE 4
  END`;
}

function matchKindSql(q: string): Prisma.Sql {
  const contains = likePattern(q, "contains");
  return Prisma.sql`CASE
    WHEN f."originalName" ILIKE ${contains} ESCAPE '\\' THEN 'filename'
    WHEN p.name ILIKE ${contains} ESCAPE '\\' THEN 'project'
    WHEN f.category ILIKE ${contains} ESCAPE '\\' THEN 'category'
    ELSE 'content'
  END`;
}

/** 正文命中的上下文片段；只回传命中点附近的一小段，不把全文带给客户端。 */
function snippetSql(q: string): Prisma.Sql {
  const contains = likePattern(q, "contains");
  return Prisma.sql`CASE
    WHEN f."textContent" ILIKE ${contains} ESCAPE '\\'
      THEN substring(
        f."textContent"
        from greatest(1, strpos(lower(f."textContent"), lower(${q})) - ${SNIPPET_RADIUS})
        for ${SNIPPET_LENGTH}
      )
    ELSE NULL
  END`;
}

/** 调用方传入了无法处理的参数，路由层映射成 400 而不是 500。 */
export class FileQueryInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileQueryInputError";
  }
}

type FileQueryCursor =
  | { sort: "relevance" | "recent"; rank: number; updatedAt: number; id: string }
  | { sort: "name"; name: string; id: string };

export function encodeFileQueryCursor(cursor: FileQueryCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf-8").toString("base64url");
}

export function decodeFileQueryCursor(value: string): FileQueryCursor {
  const invalid = () => new FileQueryInputError("无效的文件游标");
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf-8"));
  } catch {
    throw invalid();
  }
  if (!parsed || typeof parsed !== "object") {
    throw invalid();
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record.id !== "string" || !record.id) {
    throw invalid();
  }
  if (record.sort === "name") {
    if (typeof record.name !== "string") throw invalid();
    return { sort: "name", name: record.name, id: record.id };
  }
  if (record.sort === "relevance" || record.sort === "recent") {
    if (typeof record.rank !== "number" || !Number.isFinite(record.rank)) {
      throw invalid();
    }
    if (typeof record.updatedAt !== "number" || !Number.isFinite(record.updatedAt)) {
      throw invalid();
    }
    return {
      sort: record.sort,
      rank: record.rank,
      updatedAt: record.updatedAt,
      id: record.id,
    };
  }
  throw invalid();
}

export interface FileQueryInput {
  userId: string;
  q?: string | null;
  projectId?: string | null;
  category?: string | null;
  mimeGroup?: FileMimeGroup | null;
  status?: FileQueryStatus | null;
  sort?: FileQuerySort | null;
  cursor?: string | null;
  limit?: number | null;
}

export interface FileQueryItem {
  id: string;
  originalName: string;
  filename: string;
  mimeType: string;
  size: number;
  status: string;
  category: string | null;
  categoryConfidence: number | null;
  projectId: string | null;
  projectName: string | null;
  createdAt: string;
  updatedAt: string;
  hasParsedContent: boolean;
  hasEnhancedContent: boolean;
  warningCount: number;
  embeddingStatus: string | null;
  matchKind: FileMatchKind | null;
  snippet: string | null;
}

export interface FileQueryPage {
  files: FileQueryItem[];
  nextCursor: string | null;
}

interface FileQueryRow {
  id: string;
  originalName: string;
  filename: string;
  mimeType: string;
  size: number;
  status: string;
  category: string | null;
  categoryConfidence: number | null;
  projectId: string | null;
  projectName: string | null;
  createdAt: Date;
  updatedAt: Date;
  hasParsedContent: boolean;
  hasEnhancedContent: boolean;
  warningCount: number;
  embeddingStatus: string | null;
  matchKind: FileMatchKind | null;
  snippet: string | null;
  rank: number;
}

export type FileQueryClient = {
  $queryRaw: <T>(query: Prisma.Sql) => Promise<T>;
};

export async function queryFiles(
  input: FileQueryInput,
  client: FileQueryClient = prisma as unknown as FileQueryClient
): Promise<FileQueryPage> {
  const limit = normalizeFileQueryLimit(input.limit ?? null);
  const q = input.q?.trim() || null;
  const requestedSort: FileQuerySort =
    input.sort ?? (q ? "relevance" : "recent");
  // 无关键词时 relevance 无从计算，退化为按更新时间。
  const sort: FileQuerySort = q
    ? requestedSort
    : requestedSort === "name"
      ? "name"
      : "recent";

  const cursor = input.cursor ? decodeFileQueryCursor(input.cursor) : null;
  if (cursor && cursor.sort !== sort) {
    throw new FileQueryInputError("游标与当前排序方式不一致");
  }

  const conditions: Prisma.Sql[] = [Prisma.sql`f."userId" = ${input.userId}`];
  if (input.projectId) {
    conditions.push(Prisma.sql`f."projectId" = ${input.projectId}`);
  }
  if (input.category) {
    conditions.push(Prisma.sql`f.category = ${input.category}`);
  }
  if (input.mimeGroup) {
    conditions.push(
      Prisma.sql`f."mimeType" IN (${Prisma.join(GROUP_MIME_TYPES[input.mimeGroup])})`
    );
  }
  if (input.status) {
    conditions.push(statusSql(input.status));
  }
  if (q) {
    conditions.push(matchConditionSql(q));
  }

  let cursorWhere = Prisma.empty;
  if (cursor?.sort === "name") {
    cursorWhere = Prisma.sql`WHERE (
      lower(matched."originalName") > ${cursor.name}
      OR (lower(matched."originalName") = ${cursor.name} AND matched.id > ${cursor.id})
    )`;
  } else if (cursor) {
    const cursorUpdatedAt = new Date(cursor.updatedAt);
    cursorWhere = Prisma.sql`WHERE (
      matched.rank > ${cursor.rank}
      OR (
        matched.rank = ${cursor.rank}
        AND (
          matched."updatedAt" < ${cursorUpdatedAt}
          OR (matched."updatedAt" = ${cursorUpdatedAt} AND matched.id < ${cursor.id})
        )
      )
    )`;
  }

  const orderBy =
    sort === "name"
      ? Prisma.sql`ORDER BY lower(matched."originalName") ASC, matched.id ASC`
      : Prisma.sql`ORDER BY matched.rank ASC, matched."updatedAt" DESC, matched.id DESC`;

  const rows = await client.$queryRaw<FileQueryRow[]>(Prisma.sql`
    SELECT * FROM (
      SELECT
        f.id,
        f."originalName",
        f.filename,
        f."mimeType",
        f.size,
        f.status,
        f.category,
        f."categoryConfidence",
        f."projectId",
        p.name AS "projectName",
        f."createdAt",
        f."updatedAt",
        (COALESCE(f."textContent", '') <> '') AS "hasParsedContent",
        (COALESCE(f."enhancedContent", '') <> '') AS "hasEnhancedContent",
        ${WARNING_COUNT_SQL} AS "warningCount",
        f."processingMetadata" ->> 'embeddingStatus' AS "embeddingStatus",
        ${q ? matchKindSql(q) : Prisma.sql`NULL::text`} AS "matchKind",
        ${q ? snippetSql(q) : Prisma.sql`NULL::text`} AS snippet,
        ${q ? rankSql(q) : Prisma.sql`0`} AS rank
      FROM "FileAsset" f
      LEFT JOIN "Project" p ON p.id = f."projectId"
      WHERE ${Prisma.join(conditions, " AND ")}
    ) AS matched
    ${cursorWhere}
    ${orderBy}
    LIMIT ${limit + 1}
  `);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];

  return {
    files: page.map((row) => ({
      id: row.id,
      originalName: row.originalName,
      filename: row.filename,
      mimeType: row.mimeType,
      size: row.size,
      status: row.status,
      category: row.category,
      categoryConfidence: row.categoryConfidence,
      projectId: row.projectId,
      projectName: row.projectName,
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
      hasParsedContent: Boolean(row.hasParsedContent),
      hasEnhancedContent: Boolean(row.hasEnhancedContent),
      warningCount: Number(row.warningCount ?? 0),
      embeddingStatus: row.embeddingStatus,
      matchKind: row.matchKind,
      snippet: row.snippet,
    })),
    nextCursor:
      hasMore && last
        ? encodeFileQueryCursor(
            sort === "name"
              ? { sort: "name", name: last.originalName.toLowerCase(), id: last.id }
              : {
                  sort: sort === "relevance" ? "relevance" : "recent",
                  rank: Number(last.rank),
                  updatedAt: new Date(last.updatedAt).getTime(),
                  id: last.id,
                }
          )
        : null,
  };
}
