/**
 * DeepSeek 内置 web_search 的独立调用实现。
 *
 * 由于主对话流已经让 DeepSeek 自己处理 web_search，这里的场景是：
 *   - Agent continuation / DSML 回退中显式调用了 web.search 工具
 *   - 需要从 DeepSeek 拿到联网摘要 + 来源 URL
 *
 * 实现策略：
 *   1. 用系统提示要求模型调用内置 web_search（DeepSeek Anthropic 兼容端点是
 *      server tool，不支持按 name 强制 tool_choice，见 supportsForcedSearchToolChoice）。
 *   2. 若模型未产生可验证来源，降级为 HTTP 直接搜索（DuckDuckGo → Bing）。
 *   3. 从 tool_use 块或 content 中提取来源 URL。
 */

import { completeChat, type DeepSeekMessage } from "@/lib/deepseek";
import { supportsForcedSearchToolChoice } from "@/lib/chat/model-capabilities";
import { getRedis } from "@/lib/redis";
import { logger } from "@/lib/logger";

const SEARCH_MODEL = "deepseek-v4-flash";
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
    // DeepSeek 的内置 web_search 是 server tool，按 name 强制 tool_choice 会 400，
    // 因此这里不传 tool_choice，靠 buildSearchMessages 的系统提示驱动模型调用；
    // 仅对 supportsForcedSearchToolChoice 判定为支持的 provider 恢复强制。
    // 若模型未调用 web_search，runWebSearch 的 sources 判空会自动降级到
    // callSearchFallback，兜底逻辑不变。
    ...(supportsForcedSearchToolChoice("deepseek")
      ? { tool_choice: { type: "tool", name: "web_search" } }
      : {}),
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

// 每个 provider 尝试使用独立的 AbortController + 10s 超时，
// 避免上一次超时 abort 的 signal 连坐到后续 provider 的重试。
// 返回 null 表示没有相关结果（调用方应尝试下一级 provider）。
async function searchDuckDuckGo(query: string, maxResults: number): Promise<WebSearchResult | null> {
  const url = new URL(DUCKDUCKGO_HTML_SEARCH);
  url.searchParams.set("q", query);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "LumenLab-Agent/1.0" },
    });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    const results = parseDuckDuckGoResults(await response.text(), maxResults);
    return buildVerifiedResult(results, query);
  } finally {
    clearTimeout(timeout);
  }
}

async function searchBingRss(query: string, maxResults: number): Promise<WebSearchResult | null> {
  const url = new URL(BING_RSS_SEARCH);
  url.searchParams.set("format", "rss");
  url.searchParams.set("q", query);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "LumenLab-Agent/1.0" },
    });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    const results = parseBingRssResults(await response.text(), maxResults);
    return buildVerifiedResult(results, query);
  } finally {
    clearTimeout(timeout);
  }
}

/** 提取查询词项：拉丁词 + 中文二元组，用于结果相关性判断 */
function queryTerms(query: string): string[] {
  const terms = new Set<string>();
  for (const match of query.toLowerCase().matchAll(/[a-z0-9]+/g)) {
    if (match[0].length >= 2) terms.add(match[0]);
  }
  const cjk = query.replace(/[^一-鿿]/g, "");
  for (let index = 0; index + 2 <= cjk.length; index += 1) {
    terms.add(cjk.slice(index, index + 2));
  }
  return [...terms];
}

/**
 * 相关性闸门：结果标题/摘要/URL 与查询没有任何词项重合时判为无关。
 * 全部无关时返回 null——宁可让模型明说「没搜到」，也不把无关结果
 * （如中文查询下 DuckDuckGo 常返回的推广/垃圾站）塞进上下文。
 */
function buildVerifiedResult(
  items: Array<{ title: string; url: string; snippet: string }>,
  query: string
): WebSearchResult | null {
  if (items.length === 0) return null;
  const terms = queryTerms(query);
  const relevant =
    terms.length === 0
      ? items
      : items.filter((item) => {
          const haystack =
            `${item.title} ${item.snippet} ${item.url}`.toLowerCase();
          return terms.some((term) => haystack.includes(term));
        });
  if (relevant.length === 0) return null;
  return {
    summary: relevant
      .map(
        (item, index) =>
          `[^${index + 1}^] ${item.title}${item.snippet ? `\n${item.snippet}` : ""}\n${item.url}`
      )
      .join("\n\n"),
    sources: relevant.map(({ url, title }) => ({ url, title })),
    query,
  };
}

async function callSearchFallback(query: string, maxResults: number): Promise<WebSearchResult> {
  // Bing RSS 对中文查询的结果质量明显好于 DuckDuckGo HTML 抓取，因此 Bing 优先；
  // 每一级都先过相关性闸门，两级都无相关结果时返回空来源。
  const providers = [searchBingRss, searchDuckDuckGo];
  for (const provider of providers) {
    try {
      const result = await provider(query, maxResults);
      if (result) return result;
    } catch (error) {
      logger.warn("web.search fallback provider failed", {
        provider: provider.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return {
    summary: "联网搜索未找到与问题相关的可验证结果。",
    sources: [],
    query,
  };
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
