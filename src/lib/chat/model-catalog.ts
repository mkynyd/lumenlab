export const DEFAULT_CHAT_MODELS = [
  "deepseek-v4-pro",
  "deepseek-v4-flash",
  "minimax-m3",
] as const;

export const QWEN_CHAT_MODEL = "qwen3.7-plus" as const;

export const ALL_CHAT_MODELS = [
  ...DEFAULT_CHAT_MODELS,
  QWEN_CHAT_MODEL,
] as const;

export type ChatModel = (typeof ALL_CHAT_MODELS)[number];

export function isQwenModelEnabled(value = process.env.MODEL_QWEN_ENABLED) {
  return value === "true";
}

export function availableChatModels(
  qwenEnabled = process.env.MODEL_QWEN_ENABLED
): readonly ChatModel[] {
  return isQwenModelEnabled(qwenEnabled)
    ? ALL_CHAT_MODELS
    : DEFAULT_CHAT_MODELS;
}

export function isChatModelEnabled(
  model: string,
  qwenEnabled = process.env.MODEL_QWEN_ENABLED
): model is ChatModel {
  return availableChatModels(qwenEnabled).includes(model as ChatModel);
}
