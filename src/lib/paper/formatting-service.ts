import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PaperFormattingTask } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { availableChatModels, DEFAULT_CHAT_MODEL, MODEL_BILLING_VERSION } from "@/lib/chat/model-catalog";
import { getProviderApiKey } from "@/lib/data/provider-access";
import { parseAgentCheckpoint } from "@/lib/agent/executions/agent-execution-store";
import { uploadObjectBuffer, readStoredObject, type StorageProvider } from "@/lib/storage/object-storage";
import { upsertTaskNotification } from "@/lib/notifications/projection";
import { formattingSourceHash } from "./formatting-import";
import { assertFormattingTemplate, formattingTemplateAvailability } from "./formatting-template";
import { ACTIVE_FORMATTING_STAGES, FormattingError, formattingSubmissionSchema, formattingSourceType, MAX_FORMATTING_SOURCE_BYTES, FORMATTING_STAGE_LABELS, type FormattingStage } from "./formatting-contracts";

export const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));

export function formattingCheckpoint(taskId: string) {
  return parseAgentCheckpoint({ version: 2, round: 0, items: [], model: { provider: "bailian", name: DEFAULT_CHAT_MODEL }, skill: { id: null, version: null }, rag: { sourceIds: [], selectedFileIds: [] }, allowedToolIds: [], request: { message: "后台论文排版", model: DEFAULT_CHAT_MODEL, thinkingEnabled: false, reasoningEffort: "high", webSearchActive: false, skillOff: true, isQuickTask: false, materialScope: "none", executionKind: "paper-formatting", formattingTaskId: taskId } });
}

async function createFormattingExecution(tx: Prisma.TransactionClient, input: { userId: string; taskId: string; attempt: number; title: string }) {
  const conversation = await tx.conversation.create({ data: { userId: input.userId, title: input.title, kind: "paper-system", model: DEFAULT_CHAT_MODEL, thinkingEnabled: false } });
  const userMessage = await tx.message.create({ data: { conversationId: conversation.id, role: "user", content: "后台论文排版" } });
  const assistantMessage = await tx.message.create({ data: { conversationId: conversation.id, role: "assistant", content: "" } });
  return tx.agentExecution.create({ data: { userId: input.userId, conversationId: conversation.id, userMessageId: userMessage.id, assistantMessageId: assistantMessage.id, clientRunKey: `paper:${input.taskId}:${input.attempt}`, requestHash: input.taskId, checkpoint: json(formattingCheckpoint(input.taskId)) } });
}

export async function submitFormattingTask(input: { userId: string; filename: string; buffer: Buffer; submission: unknown }) {
  const submission = formattingSubmissionSchema.parse(input.submission);
  const sourceType = formattingSourceType(input.filename);
  if (!input.buffer.length || input.buffer.length > MAX_FORMATTING_SOURCE_BYTES) throw new FormattingError("SOURCE_SIZE", "原稿不能为空且不能超过 20 MB。");
  const sourceHash = formattingSourceHash(input.buffer);
  const requestHash = createHash("sha256").update(JSON.stringify({ ...submission, sourceHash, filename: input.filename })).digest("hex");
  const existing = await prisma.paperFormattingTask.findUnique({ where: { userId_requestKey: { userId: input.userId, requestKey: submission.requestKey } } });
  if (existing) {
    if (existing.requestHash !== requestHash) throw new FormattingError("REQUEST_KEY_REUSED", "此提交标识已用于另一份原稿，请重新提交。", 409);
    return existing;
  }
  if (process.env.PAPER_FORMATTING_ENABLED !== "true" || process.env.AGENT_DURABLE_EXECUTION_ENABLED !== "true") throw new FormattingError("FORMATTING_DISABLED", "后台排版暂未开放。", 503);
  if (!availableChatModels().includes(DEFAULT_CHAT_MODEL) || !process.env.BAILIAN_WORKSPACE_ID) throw new FormattingError("MODEL_UNAVAILABLE", "排版模型暂不可用，请稍后重试。", 503);
  await getProviderApiKey(input.userId, "bailian");
  const variant = await prisma.templateVariant.findUnique({ where: { id: submission.templateVariantId } });
  if (!variant) throw new FormattingError("TEMPLATE_NOT_FOUND", "模板不存在。", 404);
  const manifest = assertFormattingTemplate(variant, submission.metadata);
  const key = `paper-formatting/${input.userId}/${requestHash}/original.${sourceType === "docx" ? "docx" : "md"}`;
  const original = await uploadObjectBuffer({ key, mimeType: "application/octet-stream", buffer: input.buffer });
  try {
    return await prisma.$transaction(async (tx) => {
      // Revalidate inside acceptance transaction, then freeze the exact source used.
      const currentVariant = await tx.templateVariant.findUniqueOrThrow({ where: { id: variant.id } });
      const currentManifest = assertFormattingTemplate(currentVariant, submission.metadata);
      if (JSON.stringify(currentManifest) !== JSON.stringify(manifest)) throw new FormattingError("TEMPLATE_CHANGED", "模板版本刚刚更新，请刷新后提交。", 409);
      const taskId = randomUUID();
      const execution = await createFormattingExecution(tx, { userId: input.userId, taskId, attempt: 1, title: submission.metadata.title });
      return tx.paperFormattingTask.create({ data: { id: taskId, userId: input.userId, requestKey: submission.requestKey, requestHash, originalName: input.filename.slice(0, 255), sourceType, sourceHash, sourceProvider: original.provider, sourceObjectKey: original.key, templateVariantId: variant.id, templateSnapshot: json(manifest), actualModel: DEFAULT_CHAT_MODEL, billingVersion: MODEL_BILLING_VERSION, metadata: json(submission.metadata), executionId: execution.id } });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const winner = await prisma.paperFormattingTask.findUnique({ where: { userId_requestKey: { userId: input.userId, requestKey: submission.requestKey } } });
      if (winner?.requestHash === requestHash) return winner;
      if (winner) throw new FormattingError("REQUEST_KEY_REUSED", "此提交标识已用于另一份原稿。", 409);
    }
    throw error;
  }
}

export function formattingPublicTask(task: PaperFormattingTask) {
  const metadata = task.metadata as { title?: string };
  return { id: task.id, title: metadata.title ?? task.originalName, originalName: task.originalName, status: task.status, stage: FORMATTING_STAGE_LABELS[task.status as FormattingStage] ?? "处理中", attempt: task.attempt, completedUnits: task.completedUnits, totalUnits: task.totalUnits, documentId: task.documentId, compilationId: task.status === "completed" ? task.compilationId : null, errorCode: task.errorCode, errorMessage: task.errorMessage, createdAt: task.createdAt, updatedAt: task.updatedAt, canCancel: ACTIVE_FORMATTING_STAGES.includes(task.status as FormattingStage), canRetry: task.status === "failed" && task.attempt < 3, sourcePath: `/api/papers/formatting/${task.id}/source` };
}

/** Wizard catalog: every school record stays visible, each variant carries its own submit gate. */
export async function listFormattingTemplates(input: { query?: string } = {}) {
  const query = input.query?.trim();
  const entries = await prisma.templateRegistryEntry.findMany({
    where: query ? { university: { contains: query, mode: "insensitive" } } : {},
    orderBy: [{ university: "asc" }, { degreeType: "asc" }],
    take: 200,
    include: { variants: { orderBy: { variantKey: "asc" } } },
  });
  const templates = entries.map((entry) => ({
    id: entry.id, university: entry.university, degreeType: entry.degreeType, year: entry.year, format: entry.format,
    repositoryUrl: entry.repositoryUrl, officialSpecUrl: entry.officialSpecUrl, status: entry.status,
    variants: entry.variants.map((variant) => {
      const availability = formattingTemplateAvailability({ manifest: variant.manifest, pinnedUpstreamSnapshot: variant.pinnedUpstreamSnapshot, validation: variant.validation, sample: variant.sample, status: variant.status });
      return { id: variant.id, variantKey: variant.variantKey, adapterId: variant.adapterId, canSubmit: availability.canSubmit, reason: availability.reason, verified: availability.verified, hasLatex: availability.hasLatex, requiredMetadata: availability.requiredMetadata, sampleAvailable: Boolean(variant.sample) };
    }),
  }));
  const variants = templates.flatMap((template) => template.variants);
  return { templates, counts: { records: templates.length, variants: variants.length, latex: variants.filter((variant) => variant.hasLatex).length, verified: variants.filter((variant) => variant.verified).length, submittable: variants.filter((variant) => variant.canSubmit).length } };
}

export async function listFormattingTasks(userId: string, limit = 50) {
  const tasks = await prisma.paperFormattingTask.findMany({ where: { userId }, orderBy: { updatedAt: "desc" }, take: Math.min(Math.max(limit, 1), 200) });
  return tasks.map(formattingPublicTask);
}

export async function getFormattingTask(userId: string, taskId: string) {
  const task = await prisma.paperFormattingTask.findFirst({ where: { id: taskId, userId } });
  if (!task) throw new FormattingError("NOT_FOUND", "排版任务不存在或无权访问。", 404);
  return task;
}

export async function notifyFormattingTask(tx: Prisma.TransactionClient, task: PaperFormattingTask, suppressToast = false) {
  const kind = task.status === "needs_input" ? "waiting_user" : task.status === "completed" || task.status === "failed" || task.status === "cancelled" ? task.status : null;
  if (!kind) return;
  await upsertTaskNotification(tx, { userId: task.userId, taskType: "paper_formatting", taskId: task.id, taskAttempt: task.attempt, kind, title: (task.metadata as { title?: string }).title ?? task.originalName, summary: FORMATTING_STAGE_LABELS[task.status as FormattingStage], targetPath: `/papers/formatting/${task.id}`, ...(suppressToast ? { toastAcknowledgedAt: new Date() } : {}) });
}

export async function cancelFormattingTask(userId: string, taskId: string) {
  const task = await getFormattingTask(userId, taskId);
  return prisma.$transaction(async (tx) => {
    // Same lock order as stage writes: execution before task. Late model/compile
    // results fail their fence after this transaction revokes the execution.
    if (task.executionId) await tx.$queryRaw`SELECT id FROM "AgentExecution" WHERE id = ${task.executionId} FOR UPDATE`;
    const cancelled = await tx.paperFormattingTask.updateMany({ where: { id: taskId, userId, status: { in: ACTIVE_FORMATTING_STAGES } }, data: { status: "cancelled", completedAt: new Date() } });
    if (!cancelled.count) return false;
    if (task.executionId) await tx.agentExecution.updateMany({ where: { id: task.executionId, status: { in: ["queued", "running", "waiting_approval"] } }, data: { status: "cancelled", leaseOwner: null, leaseExpiresAt: null } });
    if (task.compilationId) await tx.paperCompilation.updateMany({ where: { id: task.compilationId, status: { in: ["queued", "running"] } }, data: { status: "cancelled", completedAt: new Date() } });
    await notifyFormattingTask(tx, { ...task, status: "cancelled" }, true);
    return true;
  });
}

export async function retryFormattingTask(userId: string, taskId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "PaperFormattingTask" WHERE id = ${taskId} AND "userId" = ${userId} FOR UPDATE`;
    const task = await tx.paperFormattingTask.findFirst({ where: { id: taskId, userId } });
    if (!task) throw new FormattingError("NOT_FOUND", "任务不存在。", 404);
    if (task.status !== "failed" || task.attempt >= 3) throw new FormattingError("RETRY_UNAVAILABLE", "当前任务不能重试。", 409);
    if (task.billingVersion !== MODEL_BILLING_VERSION) throw new FormattingError("BILLING_CHANGED", "模型计费版本已更新，请重新上传创建新任务。", 409);
    const execution = await createFormattingExecution(tx, { userId, taskId, attempt: task.attempt + 1, title: (task.metadata as { title?: string }).title ?? task.originalName });
    // Keep successful imports/mapping versions; only failed model batches are replayed.
    await tx.paperFormattingMappingBatch.updateMany({ where: { taskId, status: { not: "completed" } }, data: { status: "pending", conversationId: null, messageId: null, response: Prisma.DbNull } });
    return tx.paperFormattingTask.update({ where: { id: taskId }, data: { executionId: execution.id, attempt: { increment: 1 }, status: task.mappedVersionId ? "rendering" : task.importId ? "mapping" : "queued", compilationId: null, errorCode: null, errorMessage: null, completedAt: null } });
  });
}

export async function readFormattingOriginal(userId: string, taskId: string) {
  const task = await getFormattingTask(userId, taskId);
  const buffer = await readStoredObject({ provider: task.sourceProvider as StorageProvider, key: task.sourceObjectKey });
  if (formattingSourceHash(buffer) !== task.sourceHash) throw new FormattingError("SOURCE_CHANGED", "原稿校验失败。", 409);
  return { buffer, filename: task.originalName };
}

export async function formattingReview(userId: string, taskId: string) {
  const task = await getFormattingTask(userId, taskId);
  if (!task.importId || task.status !== "needs_input") return null;
  const imported = await prisma.paperImport.findUniqueOrThrow({ where: { id: task.importId }, include: { generatedVersion: true } });
  const { parseAcademicDocument } = await import("./document-schema");
  const { buildMappingBatches, validateMappingBatch } = await import("./formatting-mapping");
  const document = parseAcademicDocument(imported.generatedVersion?.content);
  const batches = buildMappingBatches(document);
  const rows = await prisma.paperFormattingMappingBatch.findMany({ where: { taskId }, orderBy: { batchIndex: "asc" } });
  return { blocks: batches.flatMap((batch) => batch.blocks), roles: rows.flatMap((row) => validateMappingBatch(row.response, batches[row.batchIndex])), warnings: (task.report as { lowConfidenceBlocks?: unknown }).lowConfidenceBlocks ?? [] };
}

/** Accept only structural roles for existing blocks; body/metadata writes are rejected. */
export async function confirmFormattingTask(userId: string, taskId: string, value: unknown) {
  const { z } = await import("zod");
  const { formattingRoleSchema } = await import("./formatting-contracts");
  const { parseAcademicDocument } = await import("./document-schema");
  const { buildMappingBatches, validateMappingBatch, applyFormattingRoles } = await import("./formatting-mapping");
  const confirmation = z.object({ confirmed: z.literal(true), roles: z.array(formattingRoleSchema).max(6000) }).strict().parse(value);
  const task = await getFormattingTask(userId, taskId);
  return prisma.$transaction(async (tx) => {
    if (task.executionId) await tx.$queryRaw`SELECT id FROM "AgentExecution" WHERE id = ${task.executionId} FOR UPDATE`;
    const current = await tx.paperFormattingTask.findFirst({ where: { id: taskId, userId, status: "needs_input", executionId: task.executionId } });
    if (!current?.importId) throw new FormattingError("CONFIRM_UNAVAILABLE", "当前任务无需结构确认。", 409);
    const imported = await tx.paperImport.findUniqueOrThrow({ where: { id: current.importId }, include: { generatedVersion: true } });
    const document = parseAcademicDocument(imported.generatedVersion?.content);
    const batches = buildMappingBatches(document);
    if (confirmation.roles.length !== document.blocks.length) throw new FormattingError("CONFIRM_INCOMPLETE", "请确认全部原稿结构。");
    let offset = 0;
    for (const batch of batches) {
      const roles = validateMappingBatch({ roles: confirmation.roles.slice(offset, offset + batch.blocks.length).map((role) => ({ ...role, confidence: 1 })) }, batch);
      offset += batch.blocks.length;
      await tx.paperFormattingMappingBatch.update({ where: { taskId_batchIndex: { taskId, batchIndex: batch.index } }, data: { response: json({ roles }), status: "completed" } });
    }
    applyFormattingRoles(document, confirmation.roles);
    await tx.paperImport.update({ where: { id: imported.id }, data: { status: "completed" } });
    const updated = await tx.paperFormattingTask.update({ where: { id: taskId }, data: { status: "rendering", errorCode: null, errorMessage: null, report: json({ ...(current.report as object), confirmedAt: new Date().toISOString() }) } });
    if (current.executionId) await tx.agentExecution.updateMany({ where: { id: current.executionId, status: { in: ["queued", "running"] } }, data: { status: "queued", scheduledAt: new Date(), leaseOwner: null, leaseExpiresAt: null } });
    return updated;
  });
}
