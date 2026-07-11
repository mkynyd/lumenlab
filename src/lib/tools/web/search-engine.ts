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
const SEARCH_TIMEOUT_MS = 10_000;
const DUCKDUCKGO_HTML_SEARCH = "https://html.duckduckgo.com/html/";
const BING_RSS_SEARCH = "https://www.bing.com/search";

export interface WebSearchResult {
  summary: string;
  sources: Array<{ url: string; title?: string }>;
  query: string;
  [key: string]: unknown;
}

function buildCacheKey(query: string, maxResults: number): string {
  const normalized = query.trim().replace(/\s+/g, " ").toLowerCase().slice(0, 200);
  return `websearch:v2:${maxResults}:${normalized}`;
}

function decodeHtml(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .trim();
}

function resultUrl(rawHref: string) {
  try {
    const absolute = new URL(rawHref, "https://duckduckgo.com");
    const redirected = absolute.searchParams.get("uddg");
    const url = new URL(redirected ? decodeURIComponent(redirected) : absolute.toString());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function parseDuckDuckGoResults(html: string, maxResults: number) {
  const results: Array<{ title: string; url: string; snippet: string }> = [];
  const titlePattern = /class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const matches = [...html.matchAll(titlePattern)];
  for (let index = 0; index < matches.length && results.length < maxResults; index += 1) {
    const titleMatch = matches[index];
    const url = resultUrl(decodeHtml(titleMatch[1]));
    if (!url) continue;
    const regionStart = (titleMatch.index ?? 0) + titleMatch[0].length;
    const regionEnd = matches[index + 1]?.index ?? html.length;
    const snippetMatch = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i.exec(
      html.slice(regionStart, regionEnd)
    );
    results.push({
      title: decodeHtml(titleMatch[2]) || url,
      url,
      snippet: decodeHtml(snippetMatch?.[1] ?? "").slice(0, 500),
    });
  }
  return results;
}

export function parseBingRssResults(xml: string, maxResults: number) {
  const results: Array<{ title: string; url: string; snippet: string }> = [];
  const itemPattern = /<item>([\s\S]*?)<\/item>/gi;
  let item: RegExpExecArray | null;
  while ((item = itemPattern.exec(xml)) !== null && results.length < maxResults) {
    const title = /<title>([\s\S]*?)<\/title>/i.exec(item[1])?.[1];
    const link = /<link>([\s\S]*?)<\/link>/i.exec(item[1])?.[1];
    const description = /<description>([\s\S]*?)<\/description>/i.exec(item[1])?.[1];
    if (!link) continue;
    const url = resultUrl(decodeHtml(link));
    if (!url) continue;
    results.push({
      title: decodeHtml(title ?? "") || url,
      url,
      snippet: decodeHtml(description ?? "").slice(0, 500),
    });
  }
  return results;
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

async function callSearchFallback(query: string, maxResults: number): Promise<WebSearchResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  try {
    const url = new URL(DUCKDUCKGO_HTML_SEARCH);
    url.searchParams.set("q", query);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "LumenLab-Agent/1.0" },
    });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    const results = parseDuckDuckGoResults(await response.text(), maxResults);
    if (results.length === 0) {
      throw new Error("NO_DUCKDUCKGO_RESULTS");
    }
    return {
      summary: results
        .map((item, index) => `[^${index + 1}^] ${item.title}${item.snippet ? `\n${item.snippet}` : ""}\n${item.url}`)
        .join("\n\n"),
      sources: results.map(({ url: sourceUrl, title }) => ({ url: sourceUrl, title })),
      query,
    };
  } catch (primaryError) {
    logger.warn("web.search primary provider failed", {
      error: primaryError instanceof Error ? primaryError.message : String(primaryError),
    });
    try {
      const url = new URL(BING_RSS_SEARCH);
      url.searchParams.set("format", "rss");
      url.searchParams.set("q", query);
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { "user-agent": "LumenLab-Agent/1.0" },
      });
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      const results = parseBingRssResults(await response.text(), maxResults);
      if (results.length === 0) {
        return { summary: "联网搜索未找到可验证结果。", sources: [], query };
      }
      return {
        summary: results
          .map((item, index) => `[^${index + 1}^] ${item.title}${item.snippet ? `\n${item.snippet}` : ""}\n${item.url}`)
          .join("\n\n"),
        sources: results.map(({ url: sourceUrl, title }) => ({ url: sourceUrl, title })),
        query,
      };
    } catch (error) {
      logger.warn("web.search verified fallback failed", {
      error: error instanceof Error ? error.message : String(error),
      });
      return { summary: "联网搜索暂不可用，未获取到可验证来源。", sources: [], query };
    }
  } finally {
    clearTimeout(timeout);
  }
}

export async function runWebSearch(
  query: string,
  apiKey: string,
  maxResults = 5
): Promise<WebSearchResult> {
  const userQuestionMarker = "# 用户问题";
  const userQuestionIndex = query.lastIndexOf(userQuestionMarker);
  const searchQuery = userQuestionIndex >= 0
    ? query.slice(userQuestionIndex + userQuestionMarker.length)
    : query;
  const trimmed = searchQuery
    .trim()
    .replace(/^(?:(?:最终回归|再次(?:联网)?查询|请(?:联网)?查询|联网(?:查询|查找))\s*[：:,，]?\s*)+/i, "")
    .replace(/[，,。;；]?\s*(?:并|以及)?(?:请)?(?:给出|附上|提供).*?(?:可点击)?(?:的)?来源(?:链接)?[。.]?$/i, "")
    .trim()
    .slice(0, 500);
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
            if (parsed.sources.length > 0) return parsed;
      }
    }
  } catch {
    // Cache failures are non-fatal.
  }

  let result: WebSearchResult;
  try {
    const forced = await callSearchWithToolChoice(apiKey, trimmed);
    result = forced?.sources.length
      ? forced
      : await callSearchFallback(trimmed, maxResults);
  } catch (error) {
    logger.warn("web.search forced tool_choice failed, falling back", {
      query: trimmed,
      error: error instanceof Error ? error.message : String(error),
    });
    result = await callSearchFallback(trimmed, maxResults);
  }

  try {
    await getRedis().setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(result));
  } catch {
    // Cache failures are non-fatal.
  }

  return result;
}
