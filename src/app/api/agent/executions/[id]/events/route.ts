import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { parseExecutionCursor } from "@/lib/agent/execution-cursor";
import { PrismaAgentExecutionStore } from "@/lib/agent/executions/prisma-agent-execution-store";
import { createDurableReplayResponse } from "@/lib/agent/executions/durable-response-stream";
import { CHAT_ATTACHMENT_EVENTS_HEADER } from "@/lib/agent/event-stream";
import { CHAT_ATTACHMENT_SELECT, toChatAttachmentDtos } from "@/lib/chat/message-attachments";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  const { id } = await params;
  const url = new URL(request.url);
  let afterSequence: number;
  try {
    afterSequence = parseExecutionCursor({
      lastEventId: request.headers.get("last-event-id"),
      afterSequence: url.searchParams.get("afterSequence"),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "无效的事件游标" },
      { status: 400 }
    );
  }
  const store = new PrismaAgentExecutionStore();
  const execution = await store.getOwnedExecution({
    executionId: id,
    userId: session.user.id,
  });
  if (!execution) {
    return NextResponse.json({ error: "AgentExecution 不存在" }, { status: 404 });
  }

  const chatFormat = url.searchParams.get("format") === "chat";
  const messageAttachments =
    chatFormat &&
    request.headers.get(CHAT_ATTACHMENT_EVENTS_HEADER) === "1" &&
    execution.userMessageId
      ? toChatAttachmentDtos(await prisma.messageAttachment.findMany({
          ...CHAT_ATTACHMENT_SELECT,
          where: { ...CHAT_ATTACHMENT_SELECT.where, userId: session.user.id, messageId: execution.userMessageId },
        }))
      : undefined;

  return createDurableReplayResponse({
    store,
    execution,
    userId: session.user.id,
    afterSequence,
    signal: request.signal,
    format: chatFormat ? "chat" : "durable",
    chatHeaders: chatFormat,
    messageAttachments,
  });
}
