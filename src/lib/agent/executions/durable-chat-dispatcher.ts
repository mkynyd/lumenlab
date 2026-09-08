import type { AgentRunInput } from "@/lib/agent/contracts";
import type { ServerFileAttachment } from "@/lib/chat/router";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { AgentExecutionDispatcher } from "./agent-execution-dispatcher";
import {
  AgentExecutionStoreError,
  type AgentExecutionRecord,
} from "./agent-execution-store";
import { buildInitialAgentCheckpoint } from "./durable-agent-runtime";
import { PrismaAgentExecutionStore } from "./prisma-agent-execution-store";
import { buildAgentExecutionRequestHash } from "./request-hash";

/**
 * 任务 08.7：附件内容哈希进入 request hash，避免同一句文字配不同图片时
 * 被当成重复请求返回上一次执行。哈希算法与持久化行一致（sha256 hex）。
 */
function attachmentFingerprints(attachments: ServerFileAttachment[]) {
  return attachments.map((attachment) => ({
    name: attachment.name,
    mimeType: attachment.mimeType,
    contentFingerprint: createHash("sha256")
      .update(attachment.data)
      .digest("hex"),
  }));
}

async function materialFingerprints(input: {
  userId: string;
  projectId?: string;
  selectedFileIds: string[];
}) {
  if (!input.projectId && input.selectedFileIds.length === 0) return [];
  const files = await prisma.fileAsset.findMany({
    where: {
      userId: input.userId,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.selectedFileIds.length > 0
        ? { id: { in: input.selectedFileIds } }
        : {}),
    },
    select: { id: true, contentFingerprint: true },
    orderBy: { id: "asc" },
  });
  if (
    input.selectedFileIds.length > 0 &&
    files.length !== new Set(input.selectedFileIds).size
  ) {
    throw new Error("One or more selected files are not available");
  }
  return files.map((file) => ({
    id: file.id,
    contentFingerprint:
      file.contentFingerprint ?? `unavailable:${file.id}`,
  }));
}

export async function dispatchDurableChat(input: {
  userId: string;
  clientRunKey: string;
  runInput: AgentRunInput;
  store?: PrismaAgentExecutionStore;
}): Promise<{
  execution: AgentExecutionRecord;
  created: boolean;
  store: PrismaAgentExecutionStore;
}> {
  // 任务 08.7：带附件的请求同样可以进入 durable。附件已在 /api/chat 边界落库、
  // 由 route 绑定到用户消息，Checkpoint 只保存资源引用，恢复时按资源 ID 重新
  // 鉴权读取，因此 Worker 不需要浏览器 File 对象也能继续。
  // 每对话单执行护栏:同一对话存在未终态执行时拒绝新任务,
  // 防止双开/双击导致的并发写历史与重复计费(客户端发送前会先取消旧执行)。
  if (input.runInput.conversation.id) {
    const active = await prisma.agentExecution.findFirst({
      where: {
        conversationId: input.runInput.conversation.id,
        userId: input.userId,
        status: { in: ["queued", "running", "waiting_approval"] },
      },
      select: { id: true },
    });
    if (active) {
      throw new AgentExecutionStoreError(
        "conversation_execution_in_progress",
        "该对话已有任务正在执行，请先停止或等待完成后再发送"
      );
    }
  }
  const selectedFiles = await materialFingerprints({
    userId: input.userId,
    projectId: input.runInput.conversation.projectId,
    selectedFileIds: input.runInput.capabilities.selectedFileIds,
  });
  const requestHash = buildAgentExecutionRequestHash({
    ...(input.runInput.conversation.id
      ? { conversationId: input.runInput.conversation.id }
      : {}),
    message: input.runInput.prompt.message,
    ...(input.runInput.prompt.hiddenPrompt
      ? { hiddenPrompt: input.runInput.prompt.hiddenPrompt }
      : {}),
    model: input.runInput.model.requestedModel,
    thinkingEnabled: input.runInput.model.thinkingEnabled,
    reasoningEffort: input.runInput.model.reasoningEffort,
    ...(input.runInput.conversation.projectId
      ? { projectId: input.runInput.conversation.projectId }
      : {}),
    selectedFiles,
    attachments: attachmentFingerprints(input.runInput.prompt.attachments),
    options: {
      webSearchActive: input.runInput.capabilities.webSearchActive,
      manualSkillId: input.runInput.capabilities.manualSkillId,
      skillOff: input.runInput.capabilities.skillOff,
      mode: input.runInput.capabilities.mode,
      isQuickTask: input.runInput.capabilities.isQuickTask,
      materialScope: input.runInput.capabilities.materialScope,
    },
  });
  const store = input.store ?? new PrismaAgentExecutionStore();
  const result = await new AgentExecutionDispatcher(store).dispatch({
    userId: input.userId,
    clientRunKey: input.clientRunKey,
    requestHash,
    conversation: {
      ...(input.runInput.conversation.id
        ? { id: input.runInput.conversation.id }
        : {}),
      ...(input.runInput.conversation.projectId !== undefined
        ? { projectId: input.runInput.conversation.projectId }
        : {}),
      title: "新对话",
      model: input.runInput.model.requestedModel,
      thinkingEnabled: input.runInput.model.thinkingEnabled,
    },
    userMessageContent: input.runInput.prompt.message,
    checkpoint: buildInitialAgentCheckpoint(input.runInput),
  });
  return { ...result, store };
}
