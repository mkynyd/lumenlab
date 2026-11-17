import "server-only";
import { cache } from "react";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { artifactDownloadFormats, artifactDownloadUrl, isArtifactDownloadFormat } from "@/lib/artifacts/download";
import { safeExportFilename } from "@/lib/export/filename";
import type { AgentSource } from "@/lib/agent/sources";
import { hydrateAssistantProcess } from "@/lib/agent/assistant-process";
import {
  CHAT_ATTACHMENT_SELECT,
  toChatAttachmentDtos,
} from "@/lib/chat/message-attachments";

export const chatMessageSelect = (userId: string) => ({
  id: true,
  role: true,
  content: true,
  reasoningContent: true,
  tokenCount: true,
  cacheHitTokens: true,
  cacheMissTokens: true,
  sources: true,
  createdAt: true,
  attachments: CHAT_ATTACHMENT_SELECT,
  artifacts: {
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { id: true, title: true, metadata: true },
  },
  agentExecutionsAsAssistantMessage: {
    take: 1,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      events: {
        // Message already holds the committed text and reasoning. Reading the
        // streamed copies and internal scheduler events cannot affect this view.
        where: { type: { in: ["agent_event", "run_completed", "run_failed", "run_cancelled"] } },
        orderBy: { sequence: "asc" },
        select: { type: true, payload: true, createdAt: true },
      },
    },
  },
} satisfies Prisma.MessageSelect);

export function toChatMessage({
  attachments, artifacts, agentExecutionsAsAssistantMessage, ...message
}: Prisma.MessageGetPayload<{select: ReturnType<typeof chatMessageSelect>}>) {
  const execution = agentExecutionsAsAssistantMessage[0];
  const staleApproval = message.role === "assistant" && message.content === "等待用户批准工具操作后继续。";
  const failed = execution?.status === "failed";
  const stillRunning = execution?.status === "running" || execution?.status === "queued" || execution?.status === "waiting_approval";
  return {
    ...message,
    content: staleApproval
      ? stillRunning ? "" : "上一次任务未完成，可以重新发送原请求。"
      : failed && !message.content.trim() ? "这次回答没有生成成功，可以重新发送原请求。" : message.content,
    backgroundExecutionId: stillRunning ? execution?.id : undefined,
    sources: Array.isArray(message.sources) ? (message.sources as unknown as AgentSource[]) : null,
    attachments: toChatAttachmentDtos(attachments),
    artifactDownloads: artifacts.flatMap(({ id, title, metadata }) => {
      const format = metadata && typeof metadata === "object" && !Array.isArray(metadata)
        ? metadata.delivery : null;
      return isArtifactDownloadFormat(format) ? [{
        artifactId: id,
        format,
        filename: safeExportFilename(title, artifactDownloadFormats[format].extension),
        downloadUrl: artifactDownloadUrl(id, format),
      }] : [];
    }),
    process: hydrateAssistantProcess(execution?.events ?? []),
  };
}

export const getConversation = cache(async (id: string, userId: string) => {
  const conversation = await prisma.conversation.findFirst({
    where: { id, userId, kind: "chat" },
    select: {
      id: true,
      model: true,
      messages: { orderBy: { createdAt: "asc" }, select: chatMessageSelect(userId) },
    },
  });
  return conversation ? { ...conversation, messages: conversation.messages.map(toChatMessage) } : null;
});

export const getConversations = cache(async (userId: string) =>
  prisma.conversation.findMany({
    where: { userId, kind: "chat" },
    orderBy: { updatedAt: "desc" },
    take: 100,
  })
);
