import { createHash } from "node:crypto";
import { Prisma, type PaperFormattingTask } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { runAgentRuntime } from "@/lib/agent/runtime";
import { LeaseLostDuringRun, type AgentExecutionHandler, type AgentExecutionHandlerContext } from "@/lib/agent/executions/agent-execution-runner";
import { MODEL_BILLING_VERSION, DEFAULT_CHAT_MODEL } from "@/lib/chat/model-catalog";
import { readStoredObject, uploadObjectBuffer, type StorageProvider } from "@/lib/storage/object-storage";
import { parseStructuredJson } from "@/lib/research/model-stage";
import { parseAcademicDocument } from "./document-schema";
import { normalizeTemplateManifest } from "./template-registry";
import { parseFormattingSource, formattingSourceHash } from "./formatting-import";
import { FormattingError, formattingMetadataSchema, type FormattingRole } from "./formatting-contracts";
import { applyFormattingRoles, buildMappingBatches, mappingPrompt, protectedDocumentHash, validateMappingBatch } from "./formatting-mapping";
import { json, notifyFormattingTask } from "./formatting-service";

/** Serializes cancellation and stage publication against the current execution lease. */
export async function withFormattingFence<T>(context: AgentExecutionHandlerContext, taskId: string, work: (tx: Prisma.TransactionClient, task: PaperFormattingTask) => Promise<T>): Promise<T> {
  context.signal.throwIfAborted();
  return prisma.$transaction(async (tx) => {
    // Prisma stores DateTime as `timestamp without time zone` in UTC wall-clock,
    // so the lease check must bind the same representation instead of NOW(),
    // which the database evaluates in the session time zone (Asia/Shanghai here).
    const now = new Date();
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "AgentExecution" WHERE id = ${context.execution.id} AND status = 'running' AND "leaseOwner" = ${context.execution.leaseOwner} AND attempt = ${context.execution.attempt} AND "leaseExpiresAt" > ${now} FOR UPDATE`;
    if (!rows.length) throw new LeaseLostDuringRun();
    const task = await tx.paperFormattingTask.findFirst({ where: { id: taskId, userId: context.execution.userId, executionId: context.execution.id, status: { notIn: ["cancelled", "failed", "completed"] } } });
    if (!task) throw new LeaseLostDuringRun();
    return work(tx, task);
  }, { timeout: 15_000 });
}

async function importSource(context: AgentExecutionHandlerContext, task: PaperFormattingTask) {
  await withFormattingFence(context, task.id, async (tx) => { await tx.paperFormattingTask.update({ where: { id: task.id }, data: { status: "importing" } }); });
  const buffer = await readStoredObject({ provider: task.sourceProvider as StorageProvider, key: task.sourceObjectKey });
  if (formattingSourceHash(buffer) !== task.sourceHash) throw new FormattingError("SOURCE_CHANGED", "原稿校验失败，已阻止排版。");
  const parsed = await parseFormattingSource({ filename: task.originalName, buffer, metadata: formattingMetadataSchema.parse(task.metadata), signal: context.signal });
  const uploads: Array<{ asset: typeof parsed.assets[number]; assetId: string; object: Awaited<ReturnType<typeof uploadObjectBuffer>> }> = [];
  for (const asset of parsed.assets) {
    context.signal.throwIfAborted();
    const assetId = `pf_${createHash("sha256").update(`${task.id}:${asset.placeholderId}`).digest("hex").slice(0, 32)}`;
    const object = await uploadObjectBuffer({ key: `paper-formatting/${task.userId}/${task.id}/assets/${assetId}.png`, mimeType: asset.mimeType, buffer: asset.buffer });
    uploads.push({ asset, assetId, object });
  }
  const replacements = new Map(uploads.map((upload) => [upload.asset.placeholderId, upload.assetId]));
  const content = { ...parsed.document, blocks: parsed.document.blocks.map((block) => block.kind === "figure" ? { ...block, assetId: replacements.get(block.assetId) ?? block.assetId } : block) };
  const batches = buildMappingBatches(content);
  await withFormattingFence(context, task.id, async (tx, current) => {
    if (current.importId) return;
    const workspace = await tx.paperWorkspace.create({ data: { userId: task.userId, name: content.title } });
    const document = await tx.paperDocument.create({ data: { userId: task.userId, paperWorkspaceId: workspace.id, title: content.title } });
    const version = await tx.paperDocumentVersion.create({ data: { documentId: document.id, version: 1, content: json(content), sourceHash: createHash("sha256").update(JSON.stringify(content)).digest("hex"), createdBy: "paper-formatting-import-v1" } });
    await tx.paperDocument.update({ where: { id: document.id }, data: { currentVersionId: version.id } });
    for (const upload of uploads) await tx.fileAsset.create({ data: { id: upload.assetId, userId: task.userId, filename: upload.asset.originalName, originalName: upload.asset.originalName, mimeType: upload.asset.mimeType, size: upload.asset.buffer.length, category: "paper-asset", storageProvider: upload.object.provider, storagePath: upload.object.key, contentFingerprint: formattingSourceHash(upload.asset.buffer), processingMetadata: { source: "paper-formatting", taskId: task.id, documentId: document.id } } });
    const imported = await tx.paperImport.create({ data: { paperDocumentId: document.id, userId: task.userId, originalName: task.originalName, sourceType: task.sourceType, sourceHash: task.sourceHash, originalProvider: task.sourceProvider, originalObjectKey: task.sourceObjectKey, status: parsed.report.lowConfidenceBlocks.length ? "awaiting_confirmation" : "completed", generatedVersionId: version.id, importReport: json(parsed.report), snapshots: { create: { contentHash: task.sourceHash, rawLocation: { provider: task.sourceProvider, key: task.sourceObjectKey }, parserVersion: parsed.report.parserVersion, parsedOutline: json(parsed.report) } } } });
    const manifest = normalizeTemplateManifest(task.templateSnapshot);
    await tx.templateBinding.create({ data: { paperDocumentId: document.id, templateVariantId: task.templateVariantId, lockedVersion: manifest.upstreamSnapshot!.snapshotId, versions: { create: { version: 1, manifestSnapshot: json(manifest) } } } });
    await tx.paperFormattingMappingBatch.createMany({ data: batches.map((batch) => ({ taskId: task.id, batchIndex: batch.index, inputHash: batch.inputHash })) });
    await tx.paperFormattingTask.update({ where: { id: task.id }, data: { documentId: document.id, importId: imported.id, status: "mapping", totalUnits: batches.length, completedUnits: 0, report: json({ ...parsed.report, protectedHash: protectedDocumentHash(content) }) } });
  });
}

async function mapNextBatch(context: AgentExecutionHandlerContext, task: PaperFormattingTask) {
  const imported = await prisma.paperImport.findUniqueOrThrow({ where: { id: task.importId! }, include: { generatedVersion: true } });
  const document = parseAcademicDocument(imported.generatedVersion?.content);
  const batches = buildMappingBatches(document);
  const rows = await prisma.paperFormattingMappingBatch.findMany({ where: { taskId: task.id }, orderBy: { batchIndex: "asc" } });
  const row = rows.find((item) => item.status !== "completed");
  if (!row) {
    const roles = rows.flatMap((item) => validateMappingBatch(item.response, batches[item.batchIndex]));
    const needsConfirmation = roles.some((role) => role.confidence < 0.8) || imported.status === "awaiting_confirmation";
    await withFormattingFence(context, task.id, async (tx) => {
      const updated = await tx.paperFormattingTask.update({ where: { id: task.id }, data: { status: needsConfirmation ? "needs_input" : "rendering", completedUnits: batches.length } });
      if (needsConfirmation) await notifyFormattingTask(tx, updated);
    });
    return;
  }
  const batch = batches[row.batchIndex];
  if (!batch || batch.inputHash !== row.inputHash) throw new FormattingError("MAPPING_INPUT_CHANGED", "原稿结构指纹发生变化，已阻止继续处理。");
  // A crash after dispatch has an uncertain provider outcome. Do not silently
  // issue another paid call; offer explicit retry, retaining successful batches.
  if (row.status === "started") throw new FormattingError("MAPPING_INTERRUPTED", "结构识别曾中断，未自动重复调用。可重试未完成的部分。", 409);
  if (task.billingVersion !== MODEL_BILLING_VERSION || task.actualModel !== DEFAULT_CHAT_MODEL) throw new FormattingError("BILLING_CHANGED", "模型或计费版本已更新，请重新创建排版任务。", 409);
  const conversation = await withFormattingFence(context, task.id, async (tx) => {
    const conversation = await tx.conversation.create({ data: { userId: task.userId, title: "论文结构识别", kind: "paper-system", model: task.actualModel, thinkingEnabled: false } });
    await tx.paperFormattingMappingBatch.update({ where: { id: row.id }, data: { status: "started", conversationId: conversation.id } });
    return conversation;
  });
  const run = await runAgentRuntime({ user: { id: task.userId }, conversation: { id: conversation.id }, prompt: { message: mappingPrompt(batch), attachments: [] }, model: { requestedModel: DEFAULT_CHAT_MODEL, thinkingEnabled: false, reasoningEffort: "high" }, capabilities: { webSearchActive: false, skillOff: true, selectedFileIds: [], isQuickTask: false, materialScope: "none", mode: "general" }, signal: AbortSignal.any([context.signal, AbortSignal.timeout(90_000)]) });
  for await (const event of run.events) { if (event.type === "completed") break; }
  const completion = await run.completion;
  if (completion.status !== "completed") throw new FormattingError("MODEL_INCOMPLETE", "模型未完成结构识别，请重试未完成部分。", 409);
  const message = await prisma.message.findUnique({ where: { id: completion.messageId }, select: { content: true } });
  let roles: FormattingRole[];
  let needsInput = false;
  try { roles = validateMappingBatch(parseStructuredJson(message?.content ?? ""), batch); }
  catch (error) {
    if (!(error instanceof FormattingError)) throw error;
    needsInput = true;
    roles = batch.blocks.map((block) => ({ blockId: block.blockId, role: "keep", confidence: 0 }));
  }
  await withFormattingFence(context, task.id, async (tx) => {
    await tx.paperFormattingMappingBatch.update({ where: { id: row.id }, data: { status: "completed", response: json({ roles }), messageId: completion.messageId } });
    await tx.paperFormattingTask.update({ where: { id: task.id }, data: { completedUnits: { increment: 1 }, ...(needsInput ? { errorCode: "MAPPING_NEEDS_REVIEW", errorMessage: "部分结构未能确定，请在识别结束后确认章节角色。" } : {}) } });
  });
}

async function renderAndQueue(context: AgentExecutionHandlerContext, task: PaperFormattingTask) {
  await withFormattingFence(context, task.id, async (tx, current) => {
    const imported = await tx.paperImport.findUniqueOrThrow({ where: { id: current.importId! }, include: { generatedVersion: true } });
    if (imported.status !== "completed") throw new FormattingError("IMPORT_UNCONFIRMED", "请先确认原稿结构。", 409);
    const original = parseAcademicDocument(imported.generatedVersion?.content);
    const batches = buildMappingBatches(original);
    const rows = await tx.paperFormattingMappingBatch.findMany({ where: { taskId: task.id }, orderBy: { batchIndex: "asc" } });
    if (rows.length !== batches.length || rows.some((row) => row.status !== "completed")) throw new FormattingError("MAPPING_INCOMPLETE", "结构识别尚未完成。", 409);
    const roles = rows.flatMap((row) => validateMappingBatch(row.response, batches[row.batchIndex]));
    const mapped = applyFormattingRoles(original, roles);
    let versionId = current.mappedVersionId;
    if (!versionId) {
      const version = await tx.paperDocumentVersion.create({ data: { documentId: current.documentId!, version: 2, content: json(mapped), sourceHash: createHash("sha256").update(JSON.stringify(mapped)).digest("hex"), createdBy: "paper-roles-v1" } });
      versionId = version.id;
      await tx.paperDocument.update({ where: { id: current.documentId! }, data: { currentVersionId: versionId } });
    }
    const binding = await tx.templateBindingVersion.findFirstOrThrow({ where: { binding: { paperDocumentId: current.documentId! }, version: 1 } });
    const manifest = normalizeTemplateManifest(current.templateSnapshot);
    const compilation = await tx.paperCompilation.upsert({ where: { jobKey: `formatting:${task.id}:${task.attempt}` }, create: { documentVersionId: versionId, bindingVersionId: binding.id, jobKey: `formatting:${task.id}:${task.attempt}`, engine: manifest.engine, status: "queued" }, update: {} });
    await tx.paperFormattingTask.update({ where: { id: task.id }, data: { status: "compiling", mappedVersionId: versionId, compilationId: compilation.id } });
  });
}

async function validateResult(context: AgentExecutionHandlerContext, task: PaperFormattingTask) {
  const compilation = await prisma.paperCompilation.findUniqueOrThrow({ where: { id: task.compilationId! } });
  if (compilation.status === "failed") throw new FormattingError("COMPILE_FAILED", "学校模板编译失败。原稿与已完成的结构识别已保留，可重试排版。", 409);
  if (compilation.status === "cancelled") throw new FormattingError("COMPILE_CANCELLED", "编译已取消。", 409);
  if (compilation.status !== "succeeded") return false;
  await withFormattingFence(context, task.id, async (tx) => { await tx.paperFormattingTask.update({ where: { id: task.id }, data: { status: "validating" } }); });
  if (!compilation.pdfStorageProvider || !compilation.pdfObjectKey || !compilation.sourceStorageProvider || !compilation.sourceObjectKey) throw new FormattingError("RESULT_MISSING", "排版结果尚未完整保存。", 409);
  const pdf = await readStoredObject({ provider: compilation.pdfStorageProvider as StorageProvider, key: compilation.pdfObjectKey });
  const source = await readStoredObject({ provider: compilation.sourceStorageProvider as StorageProvider, key: compilation.sourceObjectKey });
  if (!pdf.subarray(0, 5).equals(Buffer.from("%PDF-")) || !pdf.subarray(-2048).includes(Buffer.from("%%EOF")) || !source.subarray(0, 2).equals(Buffer.from("PK"))) throw new FormattingError("RESULT_INVALID", "排版文件完整性校验失败。", 409);
  const original = await prisma.paperImport.findUniqueOrThrow({ where: { id: task.importId! }, include: { generatedVersion: true } });
  const mapped = await prisma.paperDocumentVersion.findUniqueOrThrow({ where: { id: task.mappedVersionId! } });
  if (protectedDocumentHash(parseAcademicDocument(original.generatedVersion?.content)) !== protectedDocumentHash(parseAcademicDocument(mapped.content))) throw new FormattingError("CONTENT_CHANGED", "正文保真校验失败。", 409);
  await withFormattingFence(context, task.id, async (tx, current) => {
    const updated = await tx.paperFormattingTask.update({ where: { id: task.id }, data: { status: "completed", completedAt: new Date(), errorCode: null, errorMessage: null, report: json({ ...(current.report as object), result: { pdfSha256: formattingSourceHash(pdf), pdfBytes: pdf.length, sourceSha256: formattingSourceHash(source), contentIntegrity: "passed" } }) } });
    await notifyFormattingTask(tx, updated);
  });
  return true;
}

export function createPaperFormattingHandler(): AgentExecutionHandler {
  return async (context) => {
    const checkpoint = context.execution.checkpoint!;
    const taskId = checkpoint.request?.formattingTaskId;
    if (!taskId) return { kind: "failed", code: "invalid_checkpoint", message: "缺少排版任务引用", retryable: false };
    const task = await prisma.paperFormattingTask.findFirst({ where: { id: taskId, userId: context.execution.userId, executionId: context.execution.id } });
    if (!task) return { kind: "cancelled" };
    if (task.status === "completed") return { kind: "completed", checkpoint };
    if (task.status === "failed") return { kind: "failed", code: task.errorCode ?? "FORMATTING_FAILED", message: task.errorMessage ?? "排版失败", retryable: false, checkpoint };
    if (task.status === "cancelled") return { kind: "cancelled", checkpoint };
    if (task.status === "needs_input") return { kind: "rescheduled", checkpoint, scheduledAt: new Date(Date.now() + 86_400_000) };
    try {
      if (!task.importId) await importSource(context, task);
      else if (task.status === "mapping") await mapNextBatch(context, task);
      else if (task.status === "rendering") await renderAndQueue(context, task);
      else if ((task.status === "compiling" || task.status === "validating") && await validateResult(context, task)) return { kind: "completed", checkpoint };
      return { kind: "rescheduled", checkpoint, scheduledAt: new Date(Date.now() + (task.status === "compiling" ? 2000 : 10)) };
    } catch (error) {
      if (context.signal.aborted || error instanceof LeaseLostDuringRun) throw error;
      const code = error instanceof FormattingError ? error.code : "FORMATTING_FAILED";
      const message = error instanceof FormattingError ? error.message : "排版处理失败，原稿已保留。请重试或联系管理员。";
      await withFormattingFence(context, task.id, async (tx) => {
        const failed = await tx.paperFormattingTask.update({ where: { id: task.id }, data: { status: "failed", errorCode: code, errorMessage: message, completedAt: new Date() } });
        await notifyFormattingTask(tx, failed);
      });
      return { kind: "failed", code, message, retryable: false, checkpoint };
    }
  };
}
