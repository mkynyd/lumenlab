/**
 * DeepSeek 内置 web_search 的独立调用实现。
 *
 * 由于主对话流已经让 DeepSeek 自己处理 web_search，这里的场景是：
 *   - Agent continuation / DSML 回退中显式调用了 web.search 工具
 *   - 需要从 DeepSeek 拿到联网摘要 + 来源 URL
 *
 * 实现策略：
 *   1. 用 tool_choice 强制调用 web_search（如果兼容层支持）。
 *   2. 若强制失败或模型未产生内容，降级为普通 chat 请求，让模型凭知识生成回答。
 *   3. 从 tool_use 块或 content 中提取来源 URL。
 */

import { completeChat, type DeepSeekMessage } from "@/lib/deepseek";
import { getRedis } from "@/lib/redis";
import { logger } from "@/lib/logger";

const SEARCH_MODEL = "deepseek-v4-pro";
const SEARCH_MAX_TOKENS = 4096;
const CACHE_TTL_SECONDS = 60;

export interface WebSearchResult {
  summary: string;
  sources: Array<{ url: string; title?: string }>;
  query: string;
  [key: string]: unknown;
}

function buildCacheKey(query: string, maxResults: number): string {
  const normalized = query.trim().replace(/\s+/g, " ").toLowerCase().slice(0, 200);
  return `websearch:v1:${maxResults}:${normalized}`;
}

function extractUrlsFromText(text: string): string[] {
  const urlPattern = /https?:\/\/[^\s<>"'\)\]\}，。；、]+/g;
  const matches = text.match(urlPattern) ?? [];
  return [...new Set(matches.map((url) => url.replace(/[),.;!?]+$/, "")))].filter(Boolean);
}

function normalizeSources(
  toolSources: Array<{ url?: string; title?: string } | string> = [],
  fallbackUrls: string[] = []
): Array<{ url: string; title?: string }> {
  const result = new Map<string, { url: string; title?: string }>();

  for (const source of toolSources) {
    if (typeof source === "string") {
      result.set(source, { url: source });
    } else if (source && typeof source.url === "string") {
      result.set(source.url, { url: source.url, title: source.title });
    }
  }

  for (const url of fallbackUrls) {
    if (!result.has(url)) {
      result.set(url, { url });
    }
  }

  return [...result.values()];
}

function extractToolSources(responseContent: unknown[]): Array<{ url: string; title?: string }> {
  const sources: Array<{ url: string; title?: string }> = [];

  for (const block of responseContent) {
    if (!block || typeof block !== "object") continue;
    const typed = block as { type?: string; name?: string; input?: Record<string, unknown> };
    if (typed.type !== "tool_use" || typed.name !== "web_search") continue;

    const input = typed.input ?? {};
    // DeepSeek 内置 web_search 的 tool_use input 可能直接包含 sources 数组。
    const rawSources = input.sources;
    if (Array.isArray(rawSources)) {
      for (const item of rawSources) {
        if (typeof item === "string") {
          sources.push({ url: item });
        } else if (item && typeof item === "object") {
          const url = (item as { url?: string }).url;
          const title = (item as { title?: string }).title;
          if (url) sources.push({ url, title });
        }
      }
    }
  }

  return sources;
}

function buildSearchMessages(query: string): DeepSeekMessage[] {
  return [
    {
      role: "system",
      content: `你是一个联网搜索助手。用户会给你一个查询词，你必须调用 web_search 工具搜索网络，然后基于搜索结果给出简洁、准确的摘要。

要求：
- 优先使用搜索获得的信息，不要凭记忆回答。
- 摘要控制在 2000 字以内。
- 在引用处使用 [^1^]、[^2^] 等标记，并在文末列出对应的 URL 来源。
- 如果搜索没有返回有效结果，明确说明。`,
    },
    {
      role: "user",
      content: query,
    },
  ];
}

async function callSearchWithToolChoice(
  apiKey: string,
  query: string
): Promise<WebSearchResult | null> {
  const response = await completeChat(apiKey, {
    model: SEARCH_MODEL,
    messages: buildSearchMessages(query),
    thinking: { type: "disabled" },
    max_tokens: SEARCH_MAX_TOKENS,
    // DeepSeek Anthropic 兼容层通过标准 tools 字段暴露内置 web_search，
    // 使用标准 name + description + input_schema 格式触发。
    tools: [{
      name: "web_search",
      description: "联网搜索关键词并返回摘要与来源",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "搜索关键词" },
        },
        required: ["query"],
      },
    }],
    tool_choice: { type: "tool", name: "web_search" },
  });

  if (!response.content) return null;

  const toolSources = extractToolSources(response.rawContentBlocks ?? []);
  const fallbackUrls = extractUrlsFromText(response.content);
  return {
    summary: response.content,
    sources: normalizeSources(toolSources, fallbackUrls),
    query,
  };
}

async function callSearchFallback(
  apiKey: string,
  query: string
): Promise<WebSearchResult> {
  const response = await completeChat(apiKey, {
    model: SEARCH_MODEL,
    messages: buildSearchMessages(query),
    thinking: { type: "disabled" },
    max_tokens: SEARCH_MAX_TOKENS,
  });

  const summary = response.content || "未能获取到搜索结果。";
  return {
    summary,
    sources: normalizeSources([], extractUrlsFromText(summary)),
    query,
  };
}

export async function runWebSearch(
  query: string,
  apiKey: string,
  maxResults = 5
): Promise<WebSearchResult> {
  const trimmed = query.trim().slice(0, 500);
  if (!trimmed) {
    return { summary: "", sources: [], query: "" };
  }

  const cacheKey = buildCacheKey(trimmed, maxResults);
  try {
    const cached = await getRedis().get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as WebSearchResult;
      if (parsed && typeof parsed.summary === "string" && Array.isArray(parsed.sources)) {
        logger.debug("web.search cache hit", { query: trimmed });
        return parsed;
      }
    }
  } catch {
    // Cache failures are non-fatal.
  }

  let result: WebSearchResult;
  try {
    const forced = await callSearchWithToolChoice(apiKey, trimmed);
    result = forced ?? (await callSearchFallback(apiKey, trimmed));
  } catch (error) {
    logger.warn("web.search forced tool_choice failed, falling back", {
      query: trimmed,
      error: error instanceof Error ? error.message : String(error),
    });
    result = await callSearchFallback(apiKey, trimmed);
  }

  try {
    await getRedis().setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(result));
  } catch {
    // Cache failures are non-fatal.
  }

  return result;
}
