import { runWebSearch, type WebSearchOptions, type WebSearchResult } from "./search-engine";
import type { ToolExecutionContext } from "@/lib/agent/tool-executor";

export type { WebSearchResult, WebSearchOptions };

/**
 * LumenLab 的统一联网搜索能力。
 *
 * 平台自有搜索栈：AnySearch → Bing RSS → DuckDuckGo，与对话模型供应商无关。
 * 无论当前模型是 DeepSeek、Qwen、MiniMax 还是以后新增的模型，上层 Agent 都只
 * 调用本函数；模型供应商不决定实际搜索 Provider。`web.search` 也不再是任何
 * 模型的“内置 web_search”，而是由 Tool Registry 拥有的普通工具。
 */
export async function webSearch(
  _ctx: ToolExecutionContext,
  query: string,
  options: WebSearchOptions = {}
): Promise<WebSearchResult> {
  const trimmed = query.trim().slice(0, 500);
  if (!trimmed) {
    return { summary: "", sources: [], query: "" };
  }

  // Platform infrastructure key, server-only. No key means AnySearch is skipped
  // and the existing Bing/DuckDuckGo fallbacks keep search working.
  const anysearchApiKey = process.env.ANYSEARCH_API_KEY?.trim() || null;
  return runWebSearch(trimmed, options, { anysearchApiKey });
}
