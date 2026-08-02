export function modelSupportsWebSearch(model?: string | null) {
  return Boolean(model);
}

export function effectiveWebSearchActive(
  model: string | undefined | null,
  requested: boolean | undefined
) {
  return Boolean(requested && modelSupportsWebSearch(model));
}

export function supportsForcedSearchToolChoice(provider: string): boolean {
  // DeepSeek Anthropic 兼容端点将内置 web_search 暴露为 server tool，
  // 不支持按 name 强制 tool_choice（强制会返回 400）。
  return !provider.toLowerCase().startsWith("deepseek");
}
