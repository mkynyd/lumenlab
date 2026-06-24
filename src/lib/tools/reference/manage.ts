/**
 * Reference（citation-manager 简化版）
 *
 * - reference.add：用 DOI / arxivId / 手动字段新增一条文献；
 * - reference.list：按 project / conversation 列出已有文献；
 * - reference.attach：把已有文献挂到某个 artifact 上，记录 inlineMarker 和顺序；
 * - reference.format：按指定 style（apa/mla/chicago/gbt7714/ieee/harvard）渲染一条 inline + 参考文献条目。
 *
 * 跨参考项的 Crossref 元数据拉取放到后续增强（MVP 接受本地字段）。
 */

import { prisma } from "@/lib/db";

const SUPPORTED_FORMATS = new Set([
  "apa",
  "mla",
  "chicago",
  "gbt7714",
  "ieee",
  "harvard",
]);

function joinAuthorsAPA(authors: string[]): string {
  if (authors.length === 0) return "";
  if (authors.length === 1) return authors[0];
  if (authors.length <= 6) {
    const head = authors.slice(0, -1).join(", ");
    return `${head}, & ${authors[authors.length - 1]}`;
  }
  return `${authors.slice(0, 6).join(", ")}, …`;
}

function joinAuthorsMLA(authors: string[]): string {
  if (authors.length === 0) return "";
  if (authors.length === 1) return authors[0];
  return `${authors[0]}, et al.`;
}

export function formatReferenceInline(
  format: string,
  authors: string[],
  year: number | null,
  page?: string
): string {
  switch (format) {
    case "apa":
      return `(${joinAuthorsAPA(authors).split(",")[0] || "Anon"}, ${year ?? "n.d."})`;
    case "mla":
      return `(${authors[0]?.split(" ").pop() ?? "Anon"} ${page ?? ""})`.trim();
    case "chicago": {
      const lastName = authors[0]?.split(" ").pop() ?? "Anon";
      return `(${lastName} ${year ?? "n.d."}${page ? `, ${page}` : ""})`;
    }
    case "gbt7714":
      return `[${authors[0]?.split(" ").pop() ?? "Anon"}, ${year ?? "n.d."}]`;
    case "ieee":
      return "[1]";
    case "harvard":
      return `(${authors[0]?.split(" ").pop() ?? "Anon"}, ${year ?? "n.d."}${
        page ? `, p. ${page}` : ""
      })`;
    default:
      return "";
  }
}

export function formatReferenceEntry(
  format: string,
  ref: {
    title: string;
    authors: string[];
    year: number | null;
    venue: string | null;
    url: string | null;
    doi: string | null;
    arxivId: string | null;
  }
): string {
  const { title, authors, year, venue, url, doi, arxivId } = ref;
  const tail = doi ? ` https://doi.org/${doi}` : arxivId ? ` https://arxiv.org/abs/${arxivId}` : url ? ` ${url}` : "";
  switch (format) {
    case "apa":
      return `${joinAuthorsAPA(authors)} (${year ?? "n.d."}). ${title}.${venue ? ` ${venue}.` : ""}${tail}`;
    case "mla":
      return `${joinAuthorsMLA(authors)}. "${title}."${venue ? ` ${venue},` : ""} ${year ?? "n.d."}.${tail}`;
    case "chicago":
      return `${joinAuthorsAPA(authors)}. ${year ?? "n.d."}. "${title}."${venue ? ` ${venue}.` : ""}${tail}`;
    case "gbt7714": {
      const type = "J";
      const author = authors[0]?.split(" ").pop() ?? "Anon";
      return `[1] ${author}. ${title}[${type}].${venue ? ` ${venue},` : ""} ${year ?? "n.d."}.${tail}`;
    }
    case "ieee":
      return `[1] ${joinAuthorsAPA(authors)}, "${title},"${venue ? ` ${venue},` : ""} ${year ?? "n.d."}.${tail}`;
    case "harvard":
      return `${joinAuthorsAPA(authors)} (${year ?? "n.d."}) '${title}',${venue ? ` ${venue}.` : ""}${tail}`;
    default:
      return title;
  }
}

export async function addReference(
  userId: string,
  projectId: string | undefined,
  input: {
    doi?: string;
    arxivId?: string;
    title: string;
    authors?: string[];
    year?: number;
    venue?: string;
    url?: string;
  }
): Promise<Record<string, unknown>> {
  if (!input.title) {
    return { error: "TITLE_REQUIRED" };
  }
  const ref = await prisma.reference.create({
    data: {
      userId,
      projectId: projectId ?? null,
      doi: input.doi ?? null,
      arxivId: input.arxivId ?? null,
      title: input.title.slice(0, 500),
      authors: input.authors ?? [],
      year: input.year ?? null,
      venue: input.venue ?? null,
      url: input.url ?? null,
    },
  });
  return {
    id: ref.id,
    title: ref.title,
    authors: ref.authors,
    year: ref.year,
    venue: ref.venue,
    doi: ref.doi,
    arxivId: ref.arxivId,
    url: ref.url,
  };
}

export async function listReferences(
  userId: string,
  projectId?: string,
  conversationId?: string
): Promise<Record<string, unknown>> {
  // MVP：通过 conversationId 找 artifactId，再用 ReferenceListItem join 反查
  if (conversationId) {
    const artifacts = await prisma.artifact.findMany({
      where: { conversationId },
      select: { id: true },
    });
    const artifactIds = artifacts.map((a) => a.id);
    if (artifactIds.length === 0) {
      return { references: [], count: 0 };
    }
    const items = await prisma.referenceListItem.findMany({
      where: { artifactId: { in: artifactIds } },
      include: { reference: true },
      orderBy: [{ artifactId: "asc" }, { orderIndex: "asc" }],
    });
    const seen = new Set<string>();
    const references = items
      .map((item) => item.reference)
      .filter((ref) => {
        if (seen.has(ref.id)) return false;
        seen.add(ref.id);
        return true;
      });
    return { references, count: references.length };
  }
  const references = await prisma.reference.findMany({
    where: {
      userId,
      ...(projectId ? { projectId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return { references, count: references.length };
}

export async function attachReferenceToArtifact(
  userId: string,
  artifactId: string,
  referenceId: string,
  options: { format?: string; inlineMarker?: string } = {}
): Promise<Record<string, unknown>> {
  const format = options.format ?? "apa";
  if (!SUPPORTED_FORMATS.has(format)) {
    return { error: "UNSUPPORTED_FORMAT", format };
  }
  const artifact = await prisma.artifact.findFirst({
    where: { id: artifactId, userId },
    select: { id: true },
  });
  if (!artifact) return { error: "ARTIFACT_NOT_FOUND" };
  const reference = await prisma.reference.findFirst({
    where: { id: referenceId, userId },
    select: { id: true },
  });
  if (!reference) return { error: "REFERENCE_NOT_FOUND" };
  const existingCount = await prisma.referenceListItem.count({
    where: { artifactId },
  });
  const item = await prisma.referenceListItem.upsert({
    where: { artifactId_referenceId: { artifactId, referenceId } },
    update: {
      format,
      inlineMarker: options.inlineMarker ?? null,
    },
    create: {
      artifactId,
      referenceId,
      orderIndex: existingCount,
      format,
      inlineMarker: options.inlineMarker ?? null,
    },
  });
  return {
    id: item.id,
    artifactId,
    referenceId,
    orderIndex: item.orderIndex,
    format: item.format,
  };
}

export async function formatAttachedReferences(
  userId: string,
  artifactId: string,
  format: string
): Promise<Record<string, unknown>> {
  if (!SUPPORTED_FORMATS.has(format)) {
    return { error: "UNSUPPORTED_FORMAT", format };
  }
  const items = await prisma.referenceListItem.findMany({
    where: { artifactId, reference: { userId } },
    include: { reference: true },
    orderBy: { orderIndex: "asc" },
  });
  const entries = items.map((item) =>
    formatReferenceEntry(item.format || format, {
      title: item.reference.title,
      authors: item.reference.authors,
      year: item.reference.year,
      venue: item.reference.venue,
      url: item.reference.url,
      doi: item.reference.doi,
      arxivId: item.reference.arxivId,
    })
  );
  const inlineMarkers = items.map((item) =>
    item.inlineMarker ??
    formatReferenceInline(
      item.format || format,
      item.reference.authors,
      item.reference.year
    )
  );
  return {
    format,
    entries,
    inlineMarkers,
    count: entries.length,
  };
}