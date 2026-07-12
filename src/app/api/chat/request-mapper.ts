import { validateUploadBatch } from "@/lib/files/file-upload-policy";
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
}): AgentRunInput {
  const { body, attachments } = input.parsed;
  return {
    user: { id: input.userId },
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

function parseMessageBody(value: unknown): SendMessageInput {
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

export async function parseChatRequest(request: Request): Promise<ParsedChatRequest> {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("multipart/form-data")) {
    return {
      body: parseMessageBody(await request.json()),
      attachments: [],
    };
  }

  const formData = await request.formData();
  const messageField = formData.get("message");
  if (typeof messageField !== "string") {
    throw new Error("缺少消息字段");
  }

  const body = parseMessageBody(JSON.parse(messageField));
  const attachments: ServerFileAttachment[] = [];
  for (const value of formData.getAll("attachments")) {
    if (!isUploadFile(value)) continue;
    attachments.push({
      name: value.name,
      mimeType: value.type || "application/octet-stream",
      size: value.size,
      data: Buffer.from(await value.arrayBuffer()),
    });
  }

  const batchCheck = validateUploadBatch(attachments);
  if (!batchCheck.ok) {
    throw new Error(batchCheck.error);
  }

  return { body, attachments };
}
