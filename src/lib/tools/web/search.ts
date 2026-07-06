import { logger } from "@/lib/logger";
import { getProviderApiKey } from "@/lib/data/provider-access";
import { ProviderAccessError } from "@/lib/provider-access";
import { runWebSearch, type WebSearchResult } from "./search-engine";
import type { ToolExecutionContext } from "@/lib/agent/tool-executor";

export type { WebSearchResult };

/**
 * 执行联网搜索。
 *
 * 内部统一使用 DeepSeek 内置 web_search，即使主对话模型是 MiniMax。
 * 如果用户账户没有配置 DeepSeek 凭证，则抛出 ProviderAccessError。
 */
export async function webSearch(
  ctx: ToolExecutionContext,
  query: string,
  maxResults = 5
): Promise<WebSearchResult> {
  const trimmed = query.trim().slice(0, 500);
  if (!trimmed) {
    return { summary: "", sources: [], query: "" };
  }

  let apiKey: string;
  try {
    apiKey = await getProviderApiKey(ctx.userId, "deepseek");
  } catch (error) {
    logger.warn("web.search failed to resolve DeepSeek API key", {
      userId: ctx.userId,
      error: error instanceof Error ? error.message : String(error),
    });
    if (error instanceof ProviderAccessError) {
      throw new Error(`联网搜索需要 DeepSeek 服务配置：${error.message}`);
    }
    throw new Error("无法获取 DeepSeek API Key，请检查服务配置");
  }

  return runWebSearch(trimmed, apiKey, maxResults);
}
