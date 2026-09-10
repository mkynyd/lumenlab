import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { uploadObjectBuffer } from "@/lib/storage/object-storage";
import { buildSourceIdentity } from "./source-identity";
import type { ReadResearchSource, ResearchReadEvidenceType } from "./source-provider";

function json(value: unknown) {
  return JSON.parse(JSON.stringify(value));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeStatement(excerpt: string): string {
  return excerpt.replace(/\s+/g, " ").trim().slice(0, 800);
}

/**
 * system-origin Evidence 的稳定幂等键：canonical source identity + snapshot 版本
 * （contentHash）+ 归一化 locator + excerpt hash + evidence type。task 重跑、
 * lease 恢复或同一 chunk 被重复发现时得到同一个 key，配合
 * @@unique([runId, evidenceKey]) 去重。
 */
export function buildResearchEvidenceKey(input: {
  canonicalKey: string;
  contentHash: string;
  locator: Record<string, unknown>;
  excerpt: string;
  evidenceType: string;
}): string {
  const locator = input.locator;
  const stableLocator = {
    kind: typeof locator.kind === "string" ? locator.kind : null,
    docId: typeof locator.docId === "string" ? locator.docId : null,
    chunkId: typeof locator.chunkId === "string" ? locator.chunkId : null,
    offset: typeof locator.offset === "number" ? locator.offset : null,
    url: typeof locator.url === "string" ? locator.url : null,
    fileId: typeof locator.fileId === "string" ? locator.fileId : null,
  };
  return sha256(JSON.stringify({
    source: input.canonicalKey,
    snapshot: input.contentHash,
    locator: stableLocator,
    excerpt: sha256(input.excerpt),
    type: input.evidenceType,
  }));
}

export interface IngestedResearchSource {
  source: { id: string; canonicalKey: string };
  snapshot: { id: string };
  evidences: Array<{ id: string }>;
  rawContentPersisted: boolean;
}

function mergeAliases(existing: unknown, url: string | null): { urls: string[] } {
  const rawUrls = existing && typeof existing === "object" ? (existing as Record<string, unknown>).urls : null;
  const existingUrls = Array.isArray(rawUrls) ? rawUrls.filter((item): item is string => typeof item === "string") : [];
  const urls = new Set(existingUrls);
  if (url) urls.add(url);
  return { urls: [...urls] };
}

function mergeSourceMetadata(existing: unknown, next: Record<string, unknown>): Record<string, unknown> {
  const base = existing && typeof existing === "object" && !Array.isArray(existing) ? existing as Record<string, unknown> : {};
  return { ...base, ...next };
}

/**
 * Research source / snapshot / evidence 的统一 ingest 入口（从 durable-handler 抽出）。
 * 对象存储失败不再丢弃证据：rawContentLocation 可空，snapshot.excerpt 与
 * Evidence 仍落库，metadata.rawContentPersisted=false 并留下可观测日志。
 */
export async function ingestResearchReadSource(input: {
  userId: string;
  workspaceId: string;
  runId: string;
  questionId: string;
  read: ReadResearchSource | null;
}): Promise<IngestedResearchSource | null> {
  const read = input.read;
  if (!read) return null;
  const candidateMetadata = read.candidate.metadata && typeof read.candidate.metadata === "object" ? read.candidate.metadata : {};
  const metadataDoi = typeof candidateMetadata.doi === "string" ? candidateMetadata.doi : null;
  const metadataPmid = typeof candidateMetadata.pmid === "string" ? candidateMetadata.pmid : null;
  const metadataDocId = typeof candidateMetadata.docId === "string" ? candidateMetadata.docId : null;
  const metadataUniqueId = typeof candidateMetadata.uniqueId === "string" ? candidateMetadata.uniqueId : null;
  const identity = buildSourceIdentity({
    kind: read.candidate.kind === "project_file" ? "project_file" : read.candidate.kind,
    url: read.candidate.url,
    doi: read.candidate.kind === "doi" ? read.candidate.externalId : metadataDoi,
    arxivId: read.candidate.kind === "arxiv" ? read.candidate.externalId : null,
    pmid: read.candidate.kind === "pmid" ? read.candidate.externalId : metadataPmid,
    fileId: read.candidate.kind === "project_file" ? read.candidate.externalId : null,
    providerScopedId: read.candidate.provider === "sciverse" && (metadataDocId || metadataUniqueId)
      ? { provider: "sciverse", id: metadataDocId ?? metadataUniqueId ?? "" }
      : null,
  });
  const contentHash = sha256(read.content);

  let rawContentLocation: { provider: string; key: string } | null = null;
  try {
    rawContentLocation = await uploadObjectBuffer({
      key: `research/${input.userId}/${input.runId}/${contentHash}.md`,
      mimeType: "text/markdown; charset=utf-8",
      buffer: Buffer.from(read.content, "utf8"),
    });
  } catch (error) {
    console.error("[research] source raw content upload failed; persisting bounded excerpt only", {
      runId: input.runId,
      canonicalKey: identity.canonicalKey,
      message: error instanceof Error ? error.message : String(error),
    });
  }
  const rawContentPersisted = rawContentLocation !== null;

  const existingSource = await prisma.researchSource.findUnique({
    where: { workspaceId_canonicalKey: { workspaceId: input.workspaceId, canonicalKey: identity.canonicalKey } },
  });
  const source = existingSource
    ? await prisma.researchSource.update({
        where: { id: existingSource.id },
        data: {
          title: read.title || existingSource.title,
          aliases: json(mergeAliases(existingSource.aliases, read.candidate.url)),
          metadata: json(mergeSourceMetadata(existingSource.metadata, read.metadata)),
        },
      })
    : await prisma.researchSource.create({
        data: {
          workspaceId: input.workspaceId,
          userId: input.userId,
          kind: read.candidate.kind === "project_file" ? "project_file" : read.candidate.kind,
          canonicalKey: identity.canonicalKey,
          title: read.title,
          doi: identity.doi,
          arxivId: identity.arxivId,
          pmid: identity.pmid,
          canonicalUrl: identity.canonicalUrl,
          aliases: json({ urls: read.candidate.url ? [read.candidate.url] : [] }),
          metadata: json(read.metadata),
        },
      });

  const snapshotMetadata = {
    provider: read.candidate.provider,
    title: read.title,
    rawContentPersisted,
    scope: {
      ...(read.snapshotScope ?? { type: "bounded_excerpt", provider: read.candidate.provider }),
      contentLength: read.content.length,
      retrievedAt: new Date().toISOString(),
    },
  };
  const existingSnapshot = await prisma.researchSourceSnapshot.findFirst({ where: { runId: input.runId, sourceId: source.id, contentHash } });
  const snapshot = existingSnapshot ?? await prisma.researchSourceSnapshot.create({
    data: {
      workspaceId: input.workspaceId,
      runId: input.runId,
      sourceId: source.id,
      contentHash,
      sourceVersion: read.sourceVersion,
      rawContentLocation: rawContentLocation ? json(rawContentLocation) : undefined,
      excerpt: read.excerpt,
      metadata: json(snapshotMetadata),
    },
  });

  const defaultEvidenceType: ResearchReadEvidenceType = read.candidate.kind === "project_file" ? "project_context" : "direct_quote";
  const evidenceType = read.evidenceType ?? defaultEvidenceType;
  const slices = read.slices && read.slices.length > 0
    ? read.slices
    : [{ excerpt: read.excerpt, locator: read.locator, provenance: { provider: read.candidate.provider, extraction: "bounded-source-reader-v1" } }];
  const evidences: Array<{ id: string }> = [];
  for (const slice of slices) {
    const evidenceKey = buildResearchEvidenceKey({ canonicalKey: identity.canonicalKey, contentHash, locator: slice.locator, excerpt: slice.excerpt, evidenceType });
    const evidence = await prisma.evidence.upsert({
      where: { runId_evidenceKey: { runId: input.runId, evidenceKey } },
      create: {
        workspaceId: input.workspaceId,
        runId: input.runId,
        questionId: input.questionId,
        sourceSnapshotId: snapshot.id,
        statement: normalizeStatement(slice.excerpt),
        locator: json(slice.locator),
        excerpt: slice.excerpt,
        evidenceType,
        evidenceKey,
        provenance: json(slice.provenance),
      },
      update: {},
    });
    evidences.push({ id: evidence.id });
  }
  return { source: { id: source.id, canonicalKey: identity.canonicalKey }, snapshot: { id: snapshot.id }, evidences, rawContentPersisted };
}

export async function markCandidateFetched(candidateId: string, researchSourceId: string) {
  await prisma.researchSourceCandidate.update({
    where: { id: candidateId },
    data: { status: "fetched", researchSourceId },
  });
}

export async function markCandidateRejected(candidateId: string) {
  await prisma.researchSourceCandidate.updateMany({
    where: { id: candidateId, status: { not: "fetched" } },
    data: { status: "rejected" },
  });
}
