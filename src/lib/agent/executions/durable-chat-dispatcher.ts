import type { AgentRunInput } from "@/lib/agent/contracts";
import { prisma } from "@/lib/db";
import { AgentExecutionDispatcher } from "./agent-execution-dispatcher";
import type { AgentExecutionRecord } from "./agent-execution-store";
import { buildInitialAgentCheckpoint } from "./durable-agent-runtime";
import { PrismaAgentExecutionStore } from "./prisma-agent-execution-store";
import { buildAgentExecutionRequestHash } from "./request-hash";

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
  if (input.runInput.prompt.attachments.length > 0) {
    throw new Error("Durable chat does not persist request attachments");
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
    attachments: [],
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
