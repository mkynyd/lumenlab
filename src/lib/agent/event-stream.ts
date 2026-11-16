/**
 * AgentEvent ↔ SSE 序列化
 *
 * 与现有 /api/chat 的 SSE 协议共存：现有 chunk 是
 *   data: {"choices":[...]}
 * AgentEvent 是
 *   event: agent
 *   data: {"type":"tool_proposed", ...}
 * 前端按 event 名分流处理。
 */

import type { AgentEvent } from "./types";
import type { ChatAttachmentDto } from "@/lib/chat/message-attachments";

export const MESSAGE_ATTACHMENTS_EVENT = "message_attachments";
export const CHAT_ATTACHMENT_EVENTS_HEADER = "X-Chat-Attachment-Events";

export function formatMessageAttachmentsEvent(attachments: ChatAttachmentDto[]): string {
  return `event: ${MESSAGE_ATTACHMENTS_EVENT}\ndata: ${JSON.stringify(attachments)}\n\n`;
}

export function formatAgentEvent(event: AgentEvent): string {
  return `event: agent\ndata: ${JSON.stringify(event)}\n\n`;
}

export function parseAgentEvent(line: string): AgentEvent | null {
  if (!line.startsWith("data: ")) return null;
  try {
    const parsed = JSON.parse(line.slice(6));
    if (typeof parsed === "object" && parsed && "type" in parsed) {
      return parsed as AgentEvent;
    }
    return null;
  } catch {
    return null;
  }
}
