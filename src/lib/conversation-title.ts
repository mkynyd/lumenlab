export const NEW_CONVERSATION_TITLE = "新对话";

const MAX_CJK_TITLE_CHARACTERS = 18;
const MAX_SPACED_TITLE_WORDS = 10;

/**
 * 模型有时会把“信息不足/无法概括”当成标题返回。这些不是异常，而是正常文本，
 * 所以必须在写入数据库前显式拒绝，不能让拒答成为用户可见的导航标题。
 */
const REJECTED_TITLE_PATTERN =
  /(信息不足|无法概括|无法总结|无法确定|无法生成|无法命名|无法回答|不能概括|内容不足|首条消息内容不足|没有足够|未提供|抱歉|作为一个?\s*AI|无题)/iu;
const PLACEHOLDER_TITLE_PATTERN = /^新对话$/u;

function compact(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function cleanTitle(value: string) {
  return compact(value)
    .replace(/^(?:标题|对话标题)\s*[:：-]?\s*/u, "")
    .replace(/^[「『“"]+|[」』”"]+$/gu, "")
    .replace(/[。！？!?]+$/u, "");
}

function limitTitle(value: string) {
  const words = value.split(" ").filter(Boolean);
  if (words.length > 1) return words.slice(0, MAX_SPACED_TITLE_WORDS).join(" ");
  return Array.from(value).slice(0, MAX_CJK_TITLE_CHARACTERS).join("");
}

/** 首条消息或附件为空时，给一个中性的初始标题；有文本时直接用截断文本。 */
export function conversationBootstrapTitle(
  message: string,
  attachments: Array<{ mimeType?: string | null; kind?: string | null }> = []
) {
  const text = compact(message);
  if (text) return conversationTitleFallback(text);
  if (
    attachments.some(
      (attachment) =>
        attachment.kind === "image" || attachment.mimeType?.startsWith("image/")
    )
  ) {
    return "图片对话";
  }
  if (attachments.length > 0) return "文件对话";
  return NEW_CONVERSATION_TITLE;
}

export function conversationTitleFallback(message: string) {
  return limitTitle(compact(message)) || NEW_CONVERSATION_TITLE;
}

/**
 * 校验模型输出。返回 null 表示这条输出不能作为标题，调用方应保留确定性标题。
 * 不接受空串、拒答、纯标点、纯 URL 或过长文本。
 */
export function sanitizeGeneratedTitle(value: string): string | null {
  const normalized = cleanTitle(value);
  if (!normalized) return null;
  if (PLACEHOLDER_TITLE_PATTERN.test(normalized)) return null;
  if (REJECTED_TITLE_PATTERN.test(normalized)) return null;
  if (/^https?:\/\//iu.test(normalized)) return null;
  const limited = limitTitle(normalized);
  if (Array.from(limited).length < 2) return null;
  if (!/[\p{L}\p{N}]/u.test(limited)) return null;
  return limited;
}

export function normalizeConversationTitle(value: string, fallback: string) {
  return sanitizeGeneratedTitle(value) ?? fallback;
}
