/**
 * Platform-owned web.search implementation. It retrieves verifiable HTTP
 * results directly; the Agent Runtime then gives those results to the model
 * through a normal function_call_output item. This avoids a nested model call
 * and ensures every source shown to the user came from the search transport.
 */
import { getRedis } from "@/lib/redis";
import { logger } from "@/lib/logger";

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

/**
 * 把接近今天的精确日期（如「2026 年 8 月 13 日」「2026-08-13」）改写为「最新」。
 * 网页正文里几乎不存在当天/近三天的精确日期字符串，带着它检索会严重带偏
 * （实测「2026年8月13日重庆气温」在 Bing 返回百科/政府/赛程页，而「重庆天气」
 * 能命中专业气象站）。
 */
export function softenExactDates(query: string, now = new Date()): string {
  return query.replace(
    /(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?|(20\d{2})[-/](\d{1,2})[-/](\d{1,2})/g,
    (match, cy, cm, cd, iy, im, id) => {
      const year = Number(cy ?? iy);
      const month = Number(cm ?? im);
      const day = Number(cd ?? id);
      const date = new Date(year, month - 1, day);
      if (Number.isNaN(date.getTime()) || date.getDate() !== day) return match;
      const diffDays = Math.abs(date.getTime() - now.getTime()) / 86_400_000;
      return diffDays <= 3 ? "最新" : match;
    }
  );
}

export async function runWebSearch(
  query: string,
  _apiKey: string,
  maxResults = 5
): Promise<WebSearchResult> {
  const userQuestionMarker = "# 用户问题";
  const userQuestionIndex = query.lastIndexOf(userQuestionMarker);
  const searchQuery = userQuestionIndex >= 0
    ? query.slice(userQuestionIndex + userQuestionMarker.length)
    : query;
  const trimmed = softenExactDates(
    searchQuery
      .trim()
      .replace(/^(?:(?:最终回归|再次(?:联网)?查询|请(?:联网)?查询|联网(?:查询|查找))\s*[：:,，]?\s*)+/i, "")
      .replace(/[，,。;；]?\s*(?:并|以及)?(?:请)?(?:给出|附上|提供).*?(?:可点击)?(?:的)?来源(?:链接)?[。.]?$/i, "")
      .trim()
  )
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

  const result = await callSearchFallback(trimmed, maxResults);

  try {
    await getRedis().setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(result));
  } catch {
    // Cache failures are non-fatal.
  }

  return result;
}
