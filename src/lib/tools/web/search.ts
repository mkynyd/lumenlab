import { logger } from "@/lib/logger";

/**
 * MVP web 检索：依赖 DeepSeek 内置 web_search；本函数作为兜底，
 * 暂时返回 "no extra results"；后续接入独立搜索 API 时替换实现。
 */
export async function webSearch(
  query: string,
  maxResults = 5
): Promise<Record<string, unknown>> {
  const trimmed = query.trim().slice(0, 500);
  if (!trimmed) {
    return { results: [], query: "" };
  }
  logger.debug("web.search invoked", { query: trimmed, maxResults });
  return {
    results: [],
    query: trimmed,
    note: "web_search 已并入模型主路径；本工具返回空结果。",
  };
}