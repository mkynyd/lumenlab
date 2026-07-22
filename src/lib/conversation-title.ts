export const NEW_CONVERSATION_TITLE = "新对话";

const MAX_CJK_TITLE_CHARACTERS = 18;
const MAX_SPACED_TITLE_WORDS = 10;

function compact(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function limitTitle(value: string) {
  const words = value.split(" ").filter(Boolean);
  if (words.length > 1) return words.slice(0, MAX_SPACED_TITLE_WORDS).join(" ");
  return Array.from(value).slice(0, MAX_CJK_TITLE_CHARACTERS).join("");
}

export function conversationTitleFallback(message: string) {
  return limitTitle(compact(message)) || NEW_CONVERSATION_TITLE;
}

export function normalizeConversationTitle(value: string, fallback: string) {
  const normalized = compact(value)
    .replace(/^(?:标题|对话标题)\s*[:：-]?\s*/u, "")
    .replace(/^[「『“"]+|[」』”"]+$/gu, "");

  return limitTitle(normalized) || fallback;
}
