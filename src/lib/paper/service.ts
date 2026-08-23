import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { uploadObjectBuffer } from "@/lib/storage/object-storage";
import { applyDocumentPatch, assertPatchBaseVersion, type DocumentPatch } from "./document-patches";
import { buildEmptyAcademicDocument, parseAcademicDocument, type AcademicDocument } from "./document-schema";
import { renderAcademicDocumentToLatex } from "./latex-renderer";
import { parsePaperImport, type PaperImportSourceType } from "./importer";

export class PaperServiceError extends Error {
  constructor(public readonly code: "NOT_FOUND" | "INVALID_STATE" | "INVALID_INPUT", message: string) {
    super(message);
  }
}

function documentHash(document: AcademicDocument): string {
  return createHash("sha256").update(JSON.stringify(document)).digest("hex");
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

export async function listTemplateRegistry(input: { query?: string; format?: string; status?: string; limit?: number }) {
  return prisma.templateRegistryEntry.findMany({
    where: {
      ...(input.format ? { format: input.format } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.query ? { OR: [{ university: { contains: input.query, mode: "insensitive" } }, { degreeType: { contains: input.query, mode: "insensitive" } }] } : {}),
    },
    orderBy: [{ recommendationLevel: "asc" }, { university: "asc" }],
    take: Math.min(input.limit ?? 100, 500),
    include: { variants: { select: { id: true, variantKey: true, status: true, adapterId: true, validation: true, sample: true } } },
  });
}

export async function bindTemplate(input: { userId: string; documentId: string; templateVariantId: string; lockedVersion: string }) {
  await findOwnedDocument(input.userId, input.documentId);
  const variant = await prisma.templateVariant.findUnique({ where: { id: input.templateVariantId } });
  if (!variant) throw new PaperServiceError("NOT_FOUND", "模板 Variant 不存在");
  return prisma.$transaction(async (tx) => {
    const binding = await tx.templateBinding.upsert({
      where: { paperDocumentId: input.documentId },
      create: { paperDocumentId: input.documentId, templateVariantId: variant.id, lockedVersion: input.lockedVersion },
      update: { templateVariantId: variant.id, lockedVersion: input.lockedVersion },
    });
    const maxVersion = await tx.templateBindingVersion.aggregate({ where: { bindingId: binding.id }, _max: { version: true } });
    return tx.templateBindingVersion.create({
      data: { bindingId: binding.id, version: (maxVersion._max.version ?? 0) + 1, manifestSnapshot: JSON.parse(JSON.stringify(variant.manifest)) },
    });
  });
}

export async function queuePaperCompilation(userId: string, documentId: string) {
  const document = await findOwnedDocument(userId, documentId);
  const binding = await prisma.templateBinding.findUnique({ where: { paperDocumentId: documentId }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
  const rendered = renderAcademicDocumentToLatex(document.currentVersion.content as unknown as AcademicDocument);
  const jobKey = `paper:${document.currentVersion.id}:${binding?.versions[0]?.id ?? "general"}`;
  const compilation = await prisma.paperCompilation.upsert({
    where: { jobKey },
    create: {
      documentVersionId: document.currentVersion.id,
      bindingVersionId: binding?.versions[0]?.id,
      status: "queued",
      engine: "xelatex",
      jobKey,
      errorLog: { nodeMap: rendered.nodeMap },
    },
    update: { status: "queued", errorLog: { nodeMap: rendered.nodeMap }, completedAt: null },
  });
  return { compilation, rendered };
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
    const version = await createDocumentVersion({ userId: input.userId, documentId: document.id, content: parsed.document });
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
        status: "completed",
        originalProvider: original.provider,
        originalObjectKey: original.key,
        generatedVersionId: version.id,
        importReport: JSON.parse(JSON.stringify(parsed.report)),
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
