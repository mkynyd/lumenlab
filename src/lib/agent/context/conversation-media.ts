/**
 * 任务 08.6：历史图片在新回合按资源 ID 重新鉴权组装。
 *
 * 已持久化的图片附件只保存资源定位；新回合需要"接着上次那张图继续问"时，
 * 按用户当前问题、历史范围与请求预算重新读取原图，交给同一个 Responses
 * serializer。规则保持确定性：
 *   1) 当前问题提到文件名的历史图片优先；
 *   2) 其余按时间倒序取最近的，直到数量/字节预算用完；
 *   3) 不无限回传全部历史图片，超出部分只体现在覆盖说明里。
 */
import type { ConversationHistoryMessage } from "@/lib/agent/persistence/conversation-persistence";
import type { ServerFileAttachment } from "@/lib/chat/router";
import {
  loadMediaRefsWithinBudget,
  type MediaRef,
} from "@/lib/agent/context/media-ref";

export interface ConversationMediaContext {
  attachments: ServerFileAttachment[];
  /** 进入提示词的说明（携带了哪些历史图片/为什么没带）。 */
  note: string | null;
}

function extensionKeywords(name: string): string[] {
  const base = name.replace(/\.[a-z0-9]+$/i, "").toLowerCase();
  return base
    .split(/[\s_\-.]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function promptMentions(name: string, prompt: string): boolean {
  const lowered = prompt.toLowerCase();
  return extensionKeywords(name).some((token) => lowered.includes(token));
}

/** 历史消息里的图片引用，最近的在前。 */
export function historyMediaRefs(
  history: ConversationHistoryMessage[]
): MediaRef[] {
  const refs: MediaRef[] = [];
  for (const message of [...history].reverse()) {
    if (message.role !== "user" || !message.attachments?.length) continue;
    for (const attachment of message.attachments) {
      refs.push({
        source: "message-attachment",
        id: attachment.id,
        originalName: attachment.originalName,
        mimeType: attachment.mimeType,
        storageProvider: attachment.storageProvider,
        storagePath: attachment.storagePath,
        contentHash: attachment.contentHash,
      });
    }
  }
  return refs;
}

export async function resolveConversationMediaContext(input: {
  history: ConversationHistoryMessage[];
  prompt: string;
  /** 当前回合已占用的预算之外的剩余额度。 */
  maxCount: number;
  maxBytes: number;
}): Promise<ConversationMediaContext> {
  const refs = historyMediaRefs(input.history);
  if (refs.length === 0) return { attachments: [], note: null };
  if (input.maxCount <= 0 || input.maxBytes <= 0) {
    return {
      attachments: [],
      note: `历史中有 ${refs.length} 张图片，但本次请求的图片预算已被当前回合占用，未再次携带。`,
    };
  }

  const mentioned = refs.filter((ref) =>
    promptMentions(ref.originalName, input.prompt)
  );
  const mentionedIds = new Set(mentioned.map((ref) => ref.id));
  const ordered = [
    ...mentioned,
    ...refs.filter((ref) => !mentionedIds.has(ref.id)),
  ];

  const { attachments, missed } = await loadMediaRefsWithinBudget(ordered, {
    maxCount: input.maxCount,
    maxBytes: input.maxBytes,
  });
  if (attachments.length === 0) return { attachments: [], note: null };

  const parts = [
    `本次按需重新读取了 ${attachments.length} 张历史对话图片原图（按资源 ID 重新鉴权）。`,
  ];
  if (missed.length > 0) {
    parts.push(
      `另有 ${missed.length} 张历史图片因数量/大小预算未携带：${missed
        .slice(0, 5)
        .join("、")}${missed.length > 5 ? "等" : ""}。`
    );
  }
  return { attachments, note: parts.join(" ") };
}
