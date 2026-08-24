import { prisma } from "@/lib/db";
import { runAgentRuntime } from "@/lib/agent/runtime";
import { parseStructuredJson } from "@/lib/research/model-stage";
import { selectResearchModel } from "@/lib/research/model-routing";
import { createDocumentPatch, PaperServiceError } from "./service";
import { documentPatchSchema } from "./document-patches";

export const paperAssistantPatchSchema = documentPatchSchema;

export async function generatePaperDocumentPatch(input: { userId: string; documentId: string; instruction: string }) {
  const document = await prisma.paperDocument.findFirst({ where: { id: input.documentId, userId: input.userId }, include: { currentVersion: true, workspace: true } });
  if (!document || !document.currentVersion) throw new PaperServiceError("NOT_FOUND", "论文文档不存在或无权访问");
  const instruction = input.instruction.trim();
  if (instruction.length < 3) throw new PaperServiceError("INVALID_INPUT", "AI 修改指令至少需要 3 个字符");
  const selection = selectResearchModel("research.synthesizer");
  const conversation = await prisma.conversation.create({
    data: {
      userId: input.userId,
      projectId: document.workspace.projectId,
      title: `论文助手：${document.title.slice(0, 70)}`,
      model: selection.model,
      thinkingEnabled: false,
      // Reuse the existing hidden system conversation channel so the assistant
      // does not create a user-visible chat thread or a second runtime path.
      kind: "research-system",
    },
    select: { id: true },
  });
  const run = await runAgentRuntime({
    user: { id: input.userId },
    conversation: { id: conversation.id, ...(document.workspace.projectId ? { projectId: document.workspace.projectId } : {}) },
    prompt: {
      message: [
        "你是 LumenLab 论文 Document Assistant。只返回 JSON，不要 Markdown，不要展示隐藏推理，不要联网。",
        "你只能生成待用户审核的 Document Patch，绝不能直接生成 LaTeX 作为正文。",
        "格式：{\"schemaVersion\":\"1\",\"baseVersion\":数字,\"summary\":\"简短说明\",\"operations\":[{\"kind\":\"replace_block\",\"blockId\":\"已有 block id\",\"block\":{...合法 Document block...}}]}。",
        "优先使用 replace_block 修改已有正文；只在必要时 insert_block。不要删除 paper_metadata。最多 40 个 operation。",
        `用户指令：${instruction}`,
        `当前 Document Version：${document.currentVersion.version}`,
        `当前结构化 Document：${JSON.stringify(document.currentVersion.content).slice(0, 140_000)}`,
      ].join("\n\n"),
      attachments: [],
    },
    model: { requestedModel: selection.model, thinkingEnabled: false, reasoningEffort: selection.reasoningEffort },
    capabilities: { webSearchActive: false, skillOff: true, selectedFileIds: [], isQuickTask: false, mode: "general" },
    signal: AbortSignal.timeout(120_000),
  });
  for await (const event of run.events) {
    if (event.type === "completed") break;
  }
  const completion = await run.completion;
  if (completion.status !== "completed") throw new PaperServiceError("INVALID_INPUT", "论文助手未能完成本次修改建议");
  const message = await prisma.message.findUnique({ where: { id: completion.messageId }, select: { content: true } });
  const parsed = paperAssistantPatchSchema.safeParse(parseStructuredJson(message?.content ?? ""));
  if (!parsed.success) throw new PaperServiceError("INVALID_INPUT", "论文助手返回的 Document Patch 不符合结构化文档规范");
  if (parsed.data.baseVersion !== document.currentVersion.version) throw new PaperServiceError("INVALID_STATE", "Document 已更新，请重新生成 AI 修改建议");
  return createDocumentPatch({ userId: input.userId, documentId: input.documentId, patch: parsed.data });
}
