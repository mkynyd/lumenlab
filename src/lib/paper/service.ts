import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { uploadObjectBuffer } from "@/lib/storage/object-storage";
import { applyDocumentPatch, assertPatchBaseVersion, type DocumentPatch } from "./document-patches";
import { buildEmptyAcademicDocument, parseAcademicDocument, type AcademicDocument, type DocumentBlock, type InlineNode } from "./document-schema";
import { renderAcademicDocumentToLatex } from "./latex-renderer";
import { selectCompilationPreview } from "./compilation-preview";
import { parsePaperImport, type PaperImportSourceType } from "./importer";
import type { ParsedLatexReference } from "./latex-import";
import { parseBibTeX } from "./reference-import";
import { normalizeDoi } from "@/lib/research/source-identity";
import { buildGeneralAcademicTemplateManifest, isTemplateSnapshotLockValid, normalizeTemplateManifest } from "./template-registry";
import { classifyAmbiguousPaperImport } from "./import-classifier";
import { isLatexTemplateFormat } from "./template-snapshot";

export class PaperServiceError extends Error {
  constructor(public readonly code: "NOT_FOUND" | "INVALID_STATE" | "INVALID_INPUT", message: string) {
    super(message);
  }
}

function documentHash(document: AcademicDocument): string {
  return createHash("sha256").update(JSON.stringify(document)).digest("hex");
}

async function persistImportedAssets(input: {
  userId: string;
  documentId: string;
  projectId: string | null;
  importId: string;
  assets: Array<{ placeholderId: string; originalName: string; mimeType: string; buffer: Buffer }>;
}) {
  const replacements = new Map<string, string>();
  for (const asset of input.assets) {
    const safeName = asset.originalName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "asset.bin";
    const stored = await uploadObjectBuffer({
      key: `papers/${input.userId}/${input.documentId}/imports/${input.importId}/assets/${asset.placeholderId}-${safeName}`,
      mimeType: asset.mimeType,
      buffer: asset.buffer,
    });
    const file = await prisma.fileAsset.create({
      data: {
        userId: input.userId,
        projectId: input.projectId,
        filename: safeName,
        originalName: asset.originalName.slice(0, 255),
        mimeType: asset.mimeType,
        size: asset.buffer.byteLength,
        storageProvider: stored.provider,
        storagePath: stored.key,
        category: "paper-asset",
        processingMetadata: { source: "paper-import", importId: input.importId, documentId: input.documentId },
        contentFingerprint: createHash("sha256").update(asset.buffer).digest("hex"),
      },
      select: { id: true },
    });
    replacements.set(asset.placeholderId, file.id);
  }
  return replacements;
}

function replaceImportedAssetPlaceholders(document: AcademicDocument, replacements: Map<string, string>): AcademicDocument {
  return {
    ...document,
    blocks: document.blocks.map((block) => block.kind === "figure" && replacements.has(block.assetId) ? { ...block, assetId: replacements.get(block.assetId)! } : block),
  };
}

async function persistImportedReferences(input: { userId: string; paperWorkspaceId: string; references: ParsedLatexReference[] }) {
  if (input.references.length === 0) return new Map<string, string>();
  const existing = await prisma.reference.findMany({ where: { userId: input.userId, paperWorkspaceId: input.paperWorkspaceId }, select: { id: true, title: true, rawMeta: true } });
  const replacements = new Map<string, string>();
  for (const reference of input.references) {
    const existingReference = existing.find((item) => {
      const rawMeta = item.rawMeta && typeof item.rawMeta === "object" && !Array.isArray(item.rawMeta) ? item.rawMeta as Record<string, unknown> : null;
      return rawMeta?.latexKey === reference.key || item.title === reference.title;
    });
    if (existingReference) {
      replacements.set(reference.key, existingReference.id);
      continue;
    }
    const created = await prisma.reference.create({
      data: {
        userId: input.userId,
        paperWorkspaceId: input.paperWorkspaceId,
        title: reference.title.slice(0, 500),
        authors: reference.authors,
        year: reference.year ?? null,
        rawMeta: JSON.parse(JSON.stringify(reference.rawMeta)),
      },
      select: { id: true },
    });
    existing.push({ id: created.id, title: reference.title.slice(0, 500), rawMeta: JSON.parse(JSON.stringify(reference.rawMeta)) });
    replacements.set(reference.key, created.id);
  }
  return replacements;
}

function rewriteImportedInlineReferences(nodes: unknown[], replacements: Map<string, string>): unknown[] {
  return nodes.map((node) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return node;
    const value = node as Record<string, unknown>;
    if (value.kind === "citation" && typeof value.referenceId === "string" && replacements.has(value.referenceId)) return { ...value, referenceId: replacements.get(value.referenceId) };
    if (Array.isArray(value.children)) return { ...value, children: rewriteImportedInlineReferences(value.children, replacements) };
    return value;
  });
}

function rewriteImportedReferenceIds(document: AcademicDocument, replacements: Map<string, string>): AcademicDocument {
  return {
    ...document,
    blocks: document.blocks.map((block) => {
      if (block.kind === "abstract" || block.kind === "heading" || block.kind === "paragraph" || block.kind === "quote" || block.kind === "acknowledgement") return { ...block, children: rewriteImportedInlineReferences(block.children, replacements) } as DocumentBlock;
      if (block.kind === "list") return { ...block, items: block.items.map((item) => rewriteImportedInlineReferences(item, replacements) as InlineNode[]) };
      if (block.kind === "bibliography") return { ...block, referenceIds: block.referenceIds.map((id) => replacements.get(id) ?? id) };
      return block;
    }),
  };
}

export async function listPaperWorkspaces(userId: string) {
  return prisma.paperWorkspace.findMany({
    where: { userId, status: "active" },
    orderBy: { updatedAt: "desc" },
    include: {
      project: { select: { id: true, name: true } },
      document: { select: { id: true, title: true, updatedAt: true, currentVersionId: true } },
      _count: { select: { materials: true, references: true } },
    },
  });
}

export async function getPaperWorkspace(userId: string, workspaceId: string) {
  const workspace = await prisma.paperWorkspace.findFirst({
    where: { id: workspaceId, userId },
    include: {
      project: { select: { id: true, name: true } },
      document: {
        include: {
          currentVersion: true,
          bindings: { include: { templateVariant: { include: { registryEntry: true } }, versions: true } },
          patches: { orderBy: { createdAt: "desc" }, take: 20 },
        },
      },
      references: { orderBy: { createdAt: "desc" } },
      researchLinks: true,
      materials: { orderBy: { createdAt: "desc" }, take: 100 },
      _count: { select: { materials: true, references: true, researchLinks: true } },
    },
  });
  if (!workspace) throw new PaperServiceError("NOT_FOUND", "论文工作区不存在或无权访问");
  return workspace;
}

export async function createPaperWorkspace(input: {
  userId: string;
  name: string;
  projectId?: string | null;
  description?: string | null;
}) {
  if (input.projectId) {
    const project = await prisma.project.findFirst({ where: { id: input.projectId, userId: input.userId }, select: { id: true } });
    if (!project) throw new PaperServiceError("NOT_FOUND", "项目不存在或无权访问");
  }
  const document = buildEmptyAcademicDocument(input.name.trim());
  return prisma.$transaction(async (tx) => {
    const workspace = await tx.paperWorkspace.create({
      data: {
        userId: input.userId,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        projectId: input.projectId || null,
      },
    });
    const paperDocument = await tx.paperDocument.create({
      data: { paperWorkspaceId: workspace.id, userId: input.userId, title: input.name.trim() },
    });
    const version = await tx.paperDocumentVersion.create({
      data: {
        documentId: paperDocument.id,
        version: 1,
        status: "draft",
        content: JSON.parse(JSON.stringify(document)),
        sourceHash: documentHash(document),
        createdBy: input.userId,
      },
    });
    await tx.paperDocument.update({ where: { id: paperDocument.id }, data: { currentVersionId: version.id } });
    return tx.paperWorkspace.findUniqueOrThrow({ where: { id: workspace.id }, include: { document: { include: { currentVersion: true } } } });
  });
}

async function findOwnedDocument(userId: string, documentId: string) {
  const document = await prisma.paperDocument.findFirst({ where: { id: documentId, userId }, include: { currentVersion: true, workspace: true } });
  if (!document) throw new PaperServiceError("NOT_FOUND", "论文文档不存在或无权访问");
  if (!document.currentVersion) throw new PaperServiceError("INVALID_STATE", "论文文档没有当前版本");
  return { ...document, currentVersion: document.currentVersion };
}

export async function createDocumentVersion(input: { userId: string; documentId: string; content: unknown; createdBy?: string }) {
  const document = await findOwnedDocument(input.userId, input.documentId);
  const content = parseAcademicDocument(input.content);
  const version = await prisma.paperDocumentVersion.aggregate({ where: { documentId: document.id }, _max: { version: true } });
  const nextVersion = (version._max.version ?? 0) + 1;
  const created = await prisma.$transaction(async (tx) => {
    const next = await tx.paperDocumentVersion.create({
      data: {
        documentId: document.id,
        version: nextVersion,
        status: "draft",
        content: JSON.parse(JSON.stringify(content)),
        sourceHash: documentHash(content),
        createdBy: input.createdBy ?? input.userId,
      },
    });
    await tx.paperDocument.update({ where: { id: document.id }, data: { currentVersionId: next.id, title: content.title } });
    return next;
  });
  return created;
}

export async function listDocumentVersions(userId: string, documentId: string) {
  await findOwnedDocument(userId, documentId);
  return prisma.paperDocumentVersion.findMany({
    where: { documentId },
    orderBy: { version: "desc" },
    select: { id: true, version: true, status: true, createdBy: true, createdAt: true, sourceHash: true },
  });
}

/** Restore by appending the selected immutable content as a new current version. */
export async function restoreDocumentVersion(input: { userId: string; documentId: string; version: number }) {
  await findOwnedDocument(input.userId, input.documentId);
  const target = await prisma.paperDocumentVersion.findFirst({ where: { documentId: input.documentId, version: input.version }, select: { content: true } });
  if (!target) throw new PaperServiceError("NOT_FOUND", "目标 Document Version 不存在");
  return createDocumentVersion({ userId: input.userId, documentId: input.documentId, content: target.content, createdBy: input.userId });
}

export async function createDocumentPatch(input: { userId: string; documentId: string; patch: DocumentPatch; summary?: string }) {
  const document = await findOwnedDocument(input.userId, input.documentId);
  assertPatchBaseVersion(document.currentVersion.version, input.patch);
  applyDocumentPatch(document.currentVersion.content as unknown as AcademicDocument, input.patch);
  return prisma.paperDocumentPatch.create({
    data: {
      documentId: document.id,
      baseVersionId: document.currentVersion.id,
      patch: JSON.parse(JSON.stringify(input.patch)),
      summary: input.summary ?? input.patch.summary,
      createdBy: input.userId,
    },
  });
}

export async function acceptDocumentPatch(userId: string, patchId: string) {
  const patch = await prisma.paperDocumentPatch.findFirst({ where: { id: patchId, document: { userId } }, include: { document: { include: { currentVersion: true } } } });
  if (!patch || !patch.document.currentVersion) throw new PaperServiceError("NOT_FOUND", "Document Patch 不存在或无权访问");
  if (patch.status !== "pending") throw new PaperServiceError("INVALID_STATE", "Document Patch 已经处理");
  const content = applyDocumentPatch(patch.document.currentVersion.content as unknown as AcademicDocument, patch.patch as unknown as DocumentPatch);
  const next = await createDocumentVersion({ userId, documentId: patch.documentId, content });
  await prisma.paperDocumentPatch.update({ where: { id: patch.id }, data: { status: "accepted", decidedAt: new Date() } });
  return next;
}

export async function rejectDocumentPatch(userId: string, patchId: string) {
  const patch = await prisma.paperDocumentPatch.findFirst({ where: { id: patchId, document: { userId } }, select: { id: true, status: true } });
  if (!patch) throw new PaperServiceError("NOT_FOUND", "Document Patch 不存在或无权访问");
  if (patch.status !== "pending") throw new PaperServiceError("INVALID_STATE", "Document Patch 已经处理");
  return prisma.paperDocumentPatch.update({ where: { id: patch.id }, data: { status: "rejected", decidedAt: new Date() } });
}

async function findOwnedPaperWorkspace(userId: string, paperWorkspaceId: string) {
  const workspace = await prisma.paperWorkspace.findFirst({ where: { id: paperWorkspaceId, userId }, select: { id: true } });
  if (!workspace) throw new PaperServiceError("NOT_FOUND", "论文工作区不存在或无权访问");
  return workspace;
}

export async function listPaperReferences(userId: string, paperWorkspaceId: string) {
  await findOwnedPaperWorkspace(userId, paperWorkspaceId);
  return prisma.reference.findMany({ where: { paperWorkspaceId, userId }, orderBy: { createdAt: "desc" } });
}

export async function createPaperReference(input: {
  userId: string;
  paperWorkspaceId: string;
  title: string;
  authors?: string[];
  year?: number | null;
  venue?: string | null;
  doi?: string | null;
  arxivId?: string | null;
  url?: string | null;
}) {
  await findOwnedPaperWorkspace(input.userId, input.paperWorkspaceId);
  const title = input.title.trim();
  if (!title) throw new PaperServiceError("INVALID_INPUT", "Reference 标题不能为空");
  return prisma.reference.create({
    data: {
      userId: input.userId,
      paperWorkspaceId: input.paperWorkspaceId,
      title: title.slice(0, 500),
      authors: (input.authors ?? []).map((author) => author.trim()).filter(Boolean).slice(0, 64),
      year: input.year ?? null,
      venue: input.venue?.trim() || null,
      doi: normalizeDoi(input.doi ?? null),
      arxivId: input.arxivId?.trim() || null,
      url: input.url?.trim() || null,
    },
  });
}

function crossrefReference(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const message = (value as { message?: unknown }).message;
  if (!message || typeof message !== "object") return null;
  const row = message as Record<string, unknown>;
  const title = Array.isArray(row.title) ? row.title.find((item): item is string => typeof item === "string") : typeof row.title === "string" ? row.title : null;
  if (!title) return null;
  const authors = Array.isArray(row.author) ? row.author.flatMap((author) => {
    if (!author || typeof author !== "object") return [];
    const item = author as Record<string, unknown>;
    const name = [item.given, item.family].filter((part): part is string => typeof part === "string" && part.trim().length > 0).join(" ");
    return name ? [name] : [];
  }) : [];
  const date = row.published && typeof row.published === "object" ? (row.published as Record<string, unknown>)["date-parts"] : null;
  const year = Array.isArray(date) && Array.isArray(date[0]) && typeof date[0][0] === "number" ? date[0][0] : null;
  return {
    title,
    authors,
    year,
    venue: typeof row["container-title"] === "string" ? row["container-title"] : Array.isArray(row["container-title"]) && typeof row["container-title"][0] === "string" ? row["container-title"][0] : null,
    url: typeof row.URL === "string" ? row.URL : null,
    rawMeta: row,
  };
}

export async function importPaperReferenceFromDoi(input: { userId: string; paperWorkspaceId: string; doi: string }) {
  await findOwnedPaperWorkspace(input.userId, input.paperWorkspaceId);
  const doi = normalizeDoi(input.doi);
  if (!doi) throw new PaperServiceError("INVALID_INPUT", "DOI 格式无效");
  let response: Response;
  try {
    response = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, { headers: { accept: "application/json", "user-agent": "LumenLab/1.0 paper-reference-import" } });
  } catch {
    throw new PaperServiceError("INVALID_INPUT", "DOI 元数据服务暂时不可用");
  }
  if (!response.ok) throw new PaperServiceError("INVALID_INPUT", "未找到该 DOI 的元数据");
  const parsed = crossrefReference(await response.json().catch(() => null));
  if (!parsed) throw new PaperServiceError("INVALID_INPUT", "DOI 元数据缺少标题，无法导入");
  return prisma.reference.create({ data: { userId: input.userId, paperWorkspaceId: input.paperWorkspaceId, doi, title: parsed.title.slice(0, 500), authors: parsed.authors, year: parsed.year, venue: parsed.venue, url: parsed.url, rawMeta: JSON.parse(JSON.stringify(parsed.rawMeta)) } });
}

export async function importPaperReferencesFromBibTeX(input: { userId: string; paperWorkspaceId: string; bibtex: string }) {
  await findOwnedPaperWorkspace(input.userId, input.paperWorkspaceId);
  const parsed = parseBibTeX(input.bibtex);
  if (parsed.length === 0) throw new PaperServiceError("INVALID_INPUT", "没有解析出有效的 BibTeX 条目");
  return prisma.$transaction(async (tx) => {
    const created = [];
    const seen = new Set<string>();
    for (const reference of parsed) {
      const doi = normalizeDoi(reference.doi ?? null);
      const key = doi ? `doi:${doi}` : `title:${reference.title.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const existing = await tx.reference.findFirst({ where: { userId: input.userId, paperWorkspaceId: input.paperWorkspaceId, ...(doi ? { doi } : { title: reference.title }) }, select: { id: true } });
      if (existing) continue;
      created.push(await tx.reference.create({ data: { userId: input.userId, paperWorkspaceId: input.paperWorkspaceId, doi, arxivId: reference.arxivId ?? null, title: reference.title.slice(0, 500), authors: reference.authors, year: reference.year ?? null, venue: reference.venue ?? null, url: reference.url ?? null, rawMeta: JSON.parse(JSON.stringify(reference.rawMeta)) } }));
    }
    return created;
  });
}

export async function listResearchTransferCandidates(userId: string, runId: string) {
  const run = await prisma.researchRun.findFirst({ where: { id: runId, userId }, select: { id: true, workspaceId: true } });
  if (!run) throw new PaperServiceError("NOT_FOUND", "Research Run 不存在或无权访问");
  const [sources, claims, evidence, report] = await Promise.all([
    prisma.researchSource.findMany({ where: { workspaceId: run.workspaceId, candidates: { some: { runId } } }, select: { id: true, title: true, canonicalKey: true, canonicalUrl: true, doi: true, arxivId: true } }),
    prisma.claim.findMany({ where: { runId, status: "active" }, select: { id: true, statement: true, verificationStatus: true, questionId: true } }),
    prisma.evidence.findMany({ where: { runId, status: { in: ["active", "disputed"] } }, select: { id: true, statement: true, excerpt: true, sourceSnapshotId: true, questionId: true, status: true } }),
    prisma.researchReportSnapshot.findUnique({ where: { runId }, select: { id: true, generatedAt: true, contentHash: true } }),
  ]);
  return { researchWorkspaceId: run.workspaceId, sources, claims, evidence, report };
}

export async function transferResearchMaterials(input: {
  userId: string;
  paperWorkspaceId: string;
  researchRunId: string;
  sourceIds?: string[];
  claimIds?: string[];
  evidenceIds?: string[];
}) {
  await findOwnedPaperWorkspace(input.userId, input.paperWorkspaceId);
  const run = await prisma.researchRun.findFirst({ where: { id: input.researchRunId, userId: input.userId }, select: { id: true, workspaceId: true } });
  if (!run) throw new PaperServiceError("NOT_FOUND", "Research Run 不存在或无权访问");
  const sourceIds = [...new Set(input.sourceIds ?? [])];
  const claimIds = [...new Set(input.claimIds ?? [])];
  const evidenceIds = [...new Set(input.evidenceIds ?? [])];
  const [sources, claims, evidence] = await Promise.all([
    prisma.researchSource.findMany({ where: { id: { in: sourceIds }, workspaceId: run.workspaceId, candidates: { some: { runId: run.id } } }, select: { id: true } }),
    prisma.claim.findMany({ where: { id: { in: claimIds }, runId: run.id }, select: { id: true } }),
    prisma.evidence.findMany({ where: { id: { in: evidenceIds }, runId: run.id }, select: { id: true } }),
  ]);
  if (sources.length !== sourceIds.length || claims.length !== claimIds.length || evidence.length !== evidenceIds.length) {
    throw new PaperServiceError("INVALID_INPUT", "只能发送当前用户本次 Research Run 的材料");
  }
  return prisma.$transaction(async (tx) => {
    await tx.paperResearchLink.upsert({ where: { paperWorkspaceId_researchWorkspaceId: { paperWorkspaceId: input.paperWorkspaceId, researchWorkspaceId: run.workspaceId } }, create: { paperWorkspaceId: input.paperWorkspaceId, researchWorkspaceId: run.workspaceId }, update: {} });
    const created = [];
    for (const sourceId of sourceIds) {
      const existing = await tx.paperResearchMaterial.findFirst({ where: { paperWorkspaceId: input.paperWorkspaceId, sourceId, type: "source" } });
      if (!existing) created.push(await tx.paperResearchMaterial.create({ data: { paperWorkspaceId: input.paperWorkspaceId, researchWorkspaceId: run.workspaceId, researchRunId: run.id, sourceId, type: "source" } }));
    }
    for (const claimId of claimIds) {
      const existing = await tx.paperResearchMaterial.findFirst({ where: { paperWorkspaceId: input.paperWorkspaceId, claimId, type: "claim" } });
      if (!existing) created.push(await tx.paperResearchMaterial.create({ data: { paperWorkspaceId: input.paperWorkspaceId, researchWorkspaceId: run.workspaceId, researchRunId: run.id, claimId, type: "claim" } }));
    }
    for (const evidenceId of evidenceIds) {
      const existing = await tx.paperResearchMaterial.findFirst({ where: { paperWorkspaceId: input.paperWorkspaceId, evidenceId, type: "evidence" } });
      if (!existing) created.push(await tx.paperResearchMaterial.create({ data: { paperWorkspaceId: input.paperWorkspaceId, researchWorkspaceId: run.workspaceId, researchRunId: run.id, evidenceId, type: "evidence" } }));
    }
    return { createdCount: created.length, materials: created };
  });
}

export async function listTemplateRegistry(input: { query?: string; format?: string; status?: string; recommendationLevel?: string; limit?: number }) {
  return prisma.templateRegistryEntry.findMany({
    where: {
      ...(input.format ? { format: input.format } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.recommendationLevel ? { recommendationLevel: input.recommendationLevel } : {}),
      ...(input.query ? { OR: [{ university: { contains: input.query, mode: "insensitive" } }, { degreeType: { contains: input.query, mode: "insensitive" } }] } : {}),
    },
    orderBy: [{ recommendationLevel: "asc" }, { university: "asc" }],
    take: Math.min(input.limit ?? 1_000, 1_000),
    include: { variants: { select: { id: true, variantKey: true, status: true, adapterId: true, pinnedUpstreamSnapshot: true, validation: true, sample: true } } },
  });
}

export async function bindTemplate(input: { userId: string; documentId: string; templateVariantId: string; lockedVersion: string }) {
  await findOwnedDocument(input.userId, input.documentId);
  const variant = await prisma.templateVariant.findUnique({ where: { id: input.templateVariantId } });
  if (!variant) throw new PaperServiceError("NOT_FOUND", "模板 Variant 不存在");
  let manifest;
  try {
    manifest = normalizeTemplateManifest(variant.manifest);
  } catch (error) {
    throw new PaperServiceError("INVALID_INPUT", error instanceof Error ? error.message : "模板 Manifest 无效");
  }
  if (!isLatexTemplateFormat(manifest.format)) {
    throw new PaperServiceError("INVALID_INPUT", "当前只能绑定可执行的 LaTeX/Overleaf Template Variant");
  }
  const pinnedSnapshot = variant.pinnedUpstreamSnapshot && typeof variant.pinnedUpstreamSnapshot === "object" && !Array.isArray(variant.pinnedUpstreamSnapshot)
    ? variant.pinnedUpstreamSnapshot as Record<string, unknown>
    : null;
  if (pinnedSnapshot?.materialized !== true) {
    throw new PaperServiceError("INVALID_INPUT", "Template Variant 尚未固定可执行的 upstream snapshot，不能绑定到论文");
  }
  if (!isTemplateSnapshotLockValid(pinnedSnapshot, input.lockedVersion)) {
    throw new PaperServiceError("INVALID_INPUT", "Template Binding 必须锁定已审核的 upstream snapshot 版本");
  }
  return prisma.$transaction(async (tx) => {
    const binding = await tx.templateBinding.upsert({
      where: { paperDocumentId: input.documentId },
      create: { paperDocumentId: input.documentId, templateVariantId: variant.id, lockedVersion: input.lockedVersion },
      update: { templateVariantId: variant.id, lockedVersion: input.lockedVersion },
    });
    const maxVersion = await tx.templateBindingVersion.aggregate({ where: { bindingId: binding.id }, _max: { version: true } });
    return tx.templateBindingVersion.create({
      data: { bindingId: binding.id, version: (maxVersion._max.version ?? 0) + 1, manifestSnapshot: JSON.parse(JSON.stringify(manifest)) },
    });
  });
}

export async function queuePaperCompilation(userId: string, documentId: string) {
  const document = await findOwnedDocument(userId, documentId);
  const binding = await prisma.templateBinding.findUnique({ where: { paperDocumentId: documentId }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
  const references = await prisma.reference.findMany({ where: { paperWorkspaceId: document.workspace.id, userId }, orderBy: { createdAt: "asc" }, select: { id: true, title: true, authors: true, year: true, venue: true, doi: true, url: true } });
  const manifest = binding?.versions[0]?.manifestSnapshot ? normalizeTemplateManifest(binding.versions[0].manifestSnapshot) : buildGeneralAcademicTemplateManifest();
  const rendered = renderAcademicDocumentToLatex(document.currentVersion.content as unknown as AcademicDocument, { manifest, references });
  const jobKey = `paper:${document.currentVersion.id}:${binding?.versions[0]?.id ?? "general"}`;
  const compilation = await prisma.paperCompilation.upsert({
    where: { jobKey },
    create: {
      documentVersionId: document.currentVersion.id,
      bindingVersionId: binding?.versions[0]?.id,
      status: "queued",
      engine: manifest.engine ?? "xelatex",
      jobKey,
      errorLog: { nodeMap: rendered.nodeMap },
    },
    update: { status: "queued", engine: manifest.engine ?? "xelatex", errorLog: { nodeMap: rendered.nodeMap }, completedAt: null },
  });
  return { compilation, rendered };
}

export async function getLatestPaperCompilation(userId: string, documentId: string) {
  await findOwnedDocument(userId, documentId);
  const select = { id: true, status: true, engine: true, pdfStorageProvider: true, pdfObjectKey: true, sourceStorageProvider: true, sourceObjectKey: true, errorLog: true, syncTex: true, startedAt: true, completedAt: true, createdAt: true, documentVersionId: true } as const;
  const scope = { documentVersion: { documentId, document: { userId } } };
  const [compilation, lastSuccessful] = await prisma.$transaction([
    prisma.paperCompilation.findFirst({ where: scope, orderBy: { createdAt: "desc" }, select }),
    prisma.paperCompilation.findFirst({
      where: { ...scope, status: "succeeded", pdfStorageProvider: { not: null }, pdfObjectKey: { not: null } },
      orderBy: { completedAt: "desc" },
      select,
    }),
  ]);
  return { compilation, lastSuccessful, preview: selectCompilationPreview(compilation, lastSuccessful) };
}

function importSourceType(filename: string): PaperImportSourceType {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".docx")) return "docx";
  if (lower.endsWith(".tex")) return "latex";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  if (lower.endsWith(".txt")) return "txt";
  throw new PaperServiceError("INVALID_INPUT", "仅支持 DOCX、Markdown、TXT 和 LaTeX 导入");
}

export async function importPaperDocument(input: {
  userId: string;
  documentId: string;
  filename: string;
  buffer: Buffer;
}) {
  const document = await findOwnedDocument(input.userId, input.documentId);
  const sourceType = importSourceType(input.filename);
  const sourceHash = createHash("sha256").update(input.buffer).digest("hex");
  const importRow = await prisma.paperImport.create({
    data: {
      paperDocumentId: document.id,
      userId: input.userId,
      originalName: input.filename.slice(0, 255),
      sourceType,
      sourceHash,
      status: "parsing",
    },
  });
  try {
    const original = await uploadObjectBuffer({
      key: `papers/${input.userId}/${document.id}/imports/${importRow.id}/${input.filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`,
      mimeType: "application/octet-stream",
      buffer: input.buffer,
    });
    const parsed = parsePaperImport({ filename: input.filename, buffer: input.buffer });
    const assetReplacements = await persistImportedAssets({ userId: input.userId, documentId: document.id, projectId: document.workspace.projectId, importId: importRow.id, assets: parsed.assets });
    const referenceReplacements = await persistImportedReferences({ userId: input.userId, paperWorkspaceId: document.workspace.id, references: parsed.references });
    const importedDocument = rewriteImportedReferenceIds(replaceImportedAssetPlaceholders(parsed.document, assetReplacements), referenceReplacements);
    const aiClassification = parsed.report.lowConfidenceBlocks.length > 0
      ? await classifyAmbiguousPaperImport({ userId: input.userId, sourceType, document: importedDocument, lowConfidenceBlocks: parsed.report.lowConfidenceBlocks })
      : null;
    const version = await createDocumentVersion({ userId: input.userId, documentId: document.id, content: importedDocument });
    const snapshot = await prisma.paperImportSnapshot.create({
      data: {
        importId: importRow.id,
        contentHash: sourceHash,
        rawLocation: JSON.parse(JSON.stringify(original)),
        parserVersion: parsed.report.parserVersion,
        parsedOutline: JSON.parse(JSON.stringify(parsed.report)),
      },
    });
    await prisma.paperImport.update({
      where: { id: importRow.id },
      data: {
        status: parsed.report.lowConfidenceBlocks.length > 0 ? "awaiting_confirmation" : "completed",
        originalProvider: original.provider,
        originalObjectKey: original.key,
        generatedVersionId: version.id,
        importReport: JSON.parse(JSON.stringify({ ...parsed.report, assetCount: parsed.assets.length, referenceCount: parsed.references.length, aiClassification })),
      },
    });
    return { import: await prisma.paperImport.findUniqueOrThrow({ where: { id: importRow.id }, include: { snapshots: true, generatedVersion: true } }), version, snapshot };
  } catch (error) {
    await prisma.paperImport.update({
      where: { id: importRow.id },
      data: { status: "failed", importReport: { error: error instanceof Error ? error.message : String(error) } },
    });
    throw error;
  }
}

export async function getPaperImport(userId: string, importId: string) {
  const importRow = await prisma.paperImport.findFirst({
    where: { id: importId, userId, document: { userId } },
    include: { snapshots: { orderBy: { createdAt: "desc" } }, generatedVersion: true },
  });
  if (!importRow) throw new PaperServiceError("NOT_FOUND", "导入记录不存在或无权访问");
  return importRow;
}

export async function confirmPaperImport(input: { userId: string; importId: string; content?: unknown }) {
  const importRow = await getPaperImport(input.userId, input.importId);
  if (importRow.status !== "awaiting_confirmation") throw new PaperServiceError("INVALID_STATE", "当前导入记录不需要结构确认");
  let generatedVersionId = importRow.generatedVersionId;
  if (input.content !== undefined) {
    const content = parseAcademicDocument(input.content);
    const currentContent = importRow.generatedVersion?.content;
    if (JSON.stringify(content) !== JSON.stringify(currentContent)) {
      const version = await createDocumentVersion({ userId: input.userId, documentId: importRow.paperDocumentId, content });
      generatedVersionId = version.id;
    }
  }
  return prisma.paperImport.update({
    where: { id: importRow.id },
    data: { status: "completed", generatedVersionId: generatedVersionId ?? undefined },
    include: { snapshots: { orderBy: { createdAt: "desc" } }, generatedVersion: true },
  });
}
