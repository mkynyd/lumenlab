import {
  IMAGE_EXTENSIONS,
  extensionOf,
  validateImageFileBytes,
  validateUploadBatch,
} from "@/lib/files/file-upload-policy";
import { isPdfLike, repairPdfBuffer } from "@/lib/files/pdf-integrity";
import type { ServerFileAttachment } from "@/lib/chat/router";
import { sendMessageSchema, type SendMessageInput } from "@/lib/validators";
import type { AgentRunInput } from "@/lib/agent/contracts";

export interface ParsedChatRequest {
  body: SendMessageInput;
  attachments: ServerFileAttachment[];
}

export function mapAgentRunInput(input: {
  userId: string;
  parsed: ParsedChatRequest;
  signal: AbortSignal;
  clientRunKey?: string;
}): AgentRunInput {
  const { body, attachments } = input.parsed;
  return {
    user: { id: input.userId },
    ...(input.clientRunKey ? { clientRunKey: input.clientRunKey } : {}),
    conversation: {
      ...(body.conversationId ? { id: body.conversationId } : {}),
      ...(body.projectId ? { projectId: body.projectId } : {}),
    },
    prompt: {
      message: body.message,
      ...(body.hiddenPrompt ? { hiddenPrompt: body.hiddenPrompt } : {}),
      attachments,
    },
    model: {
      requestedModel: body.model,
      thinkingEnabled: body.thinkingEnabled,
      reasoningEffort: body.reasoningEffort,
    },
    capabilities: {
      webSearchActive: body.webSearchActive,
      ...(body.manualSkillId ? { manualSkillId: body.manualSkillId } : {}),
      skillOff: body.skillOff,
      selectedFileIds: body.selectedFileIds ?? [],
      ...(body.mode ? { mode: body.mode } : {}),
      isQuickTask: body.isQuickTask,
      ...(body.materialScope ? { materialScope: body.materialScope } : {}),
    },
    signal: input.signal,
  };
}

export type ResolveChatModel = (context: { conversationId?: string; projectId?: string }) => Promise<string>;

async function parseMessageBody(value: unknown, resolveModel?: ResolveChatModel): Promise<SendMessageInput> {
  if (resolveModel && value && typeof value === "object" && !("model" in value)) {
    const context = sendMessageSchema.omit({ model: true }).parse(value);
    value = { ...context, model: await resolveModel(context) };
  }
  const parsed = sendMessageSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(JSON.stringify(parsed.error.flatten().fieldErrors));
  }
  return parsed.data;
}

function isUploadFile(value: FormDataEntryValue): value is File {
  return Boolean(
    value &&
      typeof value === "object" &&
      "name" in value &&
      typeof value.name === "string" &&
      "size" in value &&
      typeof value.size === "number" &&
      "arrayBuffer" in value &&
      typeof value.arrayBuffer === "function"
  );
}

export async function parseChatRequest(request: Request, resolveModel?: ResolveChatModel): Promise<ParsedChatRequest> {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("multipart/form-data")) {
    return {
      body: await parseMessageBody(await request.json(), resolveModel),
      attachments: [],
    };
  }

  const formData = await request.formData();
  const messageField = formData.get("message");
  if (typeof messageField !== "string") {
    throw new Error("缺少消息字段");
  }

  const body = await parseMessageBody(JSON.parse(messageField), resolveModel);
  const attachments: ServerFileAttachment[] = [];
  for (const value of formData.getAll("attachments")) {
    if (!isUploadFile(value)) continue;
    let data = Buffer.from(await value.arrayBuffer());
    // PDF 附件在请求边界就完成字节校验与修复：损坏文件立即以 400 拒绝，
    // 避免把注定失败的 document block 送进模型执行。
    if (isPdfLike(value.type || "", value.name)) {
      const repaired = repairPdfBuffer(data);
      if (!repaired.ok) {
        throw new Error(`${value.name}：${repaired.reason}`);
      }
      data = repaired.data;
    }
    let mimeType = value.type || "application/octet-stream";
    if (IMAGE_EXTENSIONS[extensionOf(value.name)]) {
      const imageCheck = validateImageFileBytes(value.name, data);
      if (!imageCheck.ok) {
        throw new Error(`${value.name}：${imageCheck.error}`);
      }
      mimeType = imageCheck.mimeType;
    }
    attachments.push({
      name: value.name,
      mimeType,
      size: value.size,
      data,
    });
  }

  const batchCheck = validateUploadBatch(attachments);
  if (!batchCheck.ok) {
    throw new Error(batchCheck.error);
  }

  return { body, attachments };
}
