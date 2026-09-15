import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { queryFiles, type FileQueryItem } from "@/lib/files/file-query";

export type GlobalSearchResultType =
  | "conversation"
  | "image"
  | "document"
  | "project";

export interface GlobalSearchResult {
  id: string;
  type: GlobalSearchResultType;
  title: string;
  subtitle: string | null;
  snippet: string | null;
  href: string;
  updatedAt: string;
  mimeType?: string;
}

export interface GlobalSearchResponse {
  query: string;
  results: GlobalSearchResult[];
  counts: Record<GlobalSearchResultType, number>;
}

interface ConversationSearchRow {
  id: string;
  title: string;
  snippet: string | null;
  updatedAt: Date;
}

interface ProjectSearchRow {
  id: string;
  name: string;
  description: string | null;
  updatedAt: Date;
}

const RESULT_LIMIT = 10;
const SNIPPET_LENGTH = 180;

function likePattern(value: string) {
  return `%${value.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

function fileResult(
  file: FileQueryItem,
  type: "image" | "document"
): GlobalSearchResult {
  return {
    id: file.id,
    type,
    title: file.originalName,
    subtitle: file.projectName || (type === "image" ? "图片" : "资料"),
    snippet: file.snippet,
    href: `/files/${file.id}`,
    updatedAt: file.updatedAt,
    mimeType: file.mimeType,
  };
}

export async function searchGlobal(input: {
  userId: string;
  query: string;
}): Promise<GlobalSearchResponse> {
  const query = input.query.trim();
  if (!query) {
    return {
      query,
      results: [],
      counts: { conversation: 0, image: 0, document: 0, project: 0 },
    };
  }

  const contains = likePattern(query);
  const [conversations, projects, images, documents] = await Promise.all([
    prisma.$queryRaw<ConversationSearchRow[]>(Prisma.sql`
      SELECT
        c.id,
        c.title,
        (
          SELECT substring(m.content for ${SNIPPET_LENGTH})
          FROM "Message" m
          WHERE m."conversationId" = c.id
            AND m.role <> 'system'
            AND m.content ILIKE ${contains} ESCAPE '\\'
          ORDER BY m."createdAt" DESC
          LIMIT 1
        ) AS snippet,
        c."updatedAt"
      FROM "Conversation" c
      WHERE c."userId" = ${input.userId}
        AND c."projectId" IS NULL
        AND c.kind = 'chat'
        AND (
          c.title ILIKE ${contains} ESCAPE '\\'
          OR EXISTS (
            SELECT 1 FROM "Message" m
            WHERE m."conversationId" = c.id
              AND m.role <> 'system'
              AND m.content ILIKE ${contains} ESCAPE '\\'
          )
        )
      ORDER BY
        CASE
          WHEN lower(c.title) = ${query.toLowerCase()} THEN 0
          WHEN c.title ILIKE ${`${query.replace(/[\\%_]/g, (character) => `\\${character}`)}%`} ESCAPE '\\' THEN 1
          WHEN c.title ILIKE ${contains} ESCAPE '\\' THEN 2
          ELSE 3
        END,
        c."updatedAt" DESC
      LIMIT ${RESULT_LIMIT}
    `),
    prisma.$queryRaw<ProjectSearchRow[]>(Prisma.sql`
      SELECT p.id, p.name, p.description, p."updatedAt"
      FROM "Project" p
      WHERE p."userId" = ${input.userId}
        AND (
          p.name ILIKE ${contains} ESCAPE '\\'
          OR p.description ILIKE ${contains} ESCAPE '\\'
        )
      ORDER BY
        CASE
          WHEN lower(p.name) = ${query.toLowerCase()} THEN 0
          WHEN p.name ILIKE ${`${query.replace(/[\\%_]/g, (character) => `\\${character}`)}%`} ESCAPE '\\' THEN 1
          ELSE 2
        END,
        p."updatedAt" DESC
      LIMIT ${RESULT_LIMIT}
    `),
    queryFiles({
      userId: input.userId,
      q: query,
      mimeGroup: "image",
      limit: RESULT_LIMIT,
    }),
    queryFiles({
      userId: input.userId,
      q: query,
      mimeGroups: ["document", "text", "data", "code"],
      limit: RESULT_LIMIT,
    }),
  ]);

  const imageResults = images.files.map((file) => fileResult(file, "image"));
  const documentResults = documents.files.map((file) =>
    fileResult(file, "document")
  );
  const conversationResults: GlobalSearchResult[] = conversations.map((item) => ({
    id: item.id,
    type: "conversation",
    title: item.title,
    subtitle: "对话",
    snippet: item.snippet,
    href: `/chat/${item.id}`,
    updatedAt: new Date(item.updatedAt).toISOString(),
  }));
  const projectResults: GlobalSearchResult[] = projects.map((item) => ({
    id: item.id,
    type: "project",
    title: item.name,
    subtitle: "项目",
    snippet: item.description,
    href: `/projects/${item.id}`,
    updatedAt: new Date(item.updatedAt).toISOString(),
  }));

  const results = [
    ...conversationResults,
    ...imageResults,
    ...documentResults,
    ...projectResults,
  ];

  return {
    query,
    results,
    counts: {
      conversation: conversationResults.length,
      image: imageResults.length,
      document: documentResults.length,
      project: projectResults.length,
    },
  };
}
