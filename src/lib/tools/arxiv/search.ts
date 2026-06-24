/**
 * arxiv.search — arXiv API 关键词搜索
 *
 * 文档：http://export.arxiv.org/api_help/
 * 仅搜索 cs.* / stat.ML / math.* 类目，按用户 query 拼接；
 * 任何 401/403/超时返回 {error}。
 */

import { logger } from "@/lib/logger";

const ARXIV_API = "http://export.arxiv.org/api/query";
const FETCH_TIMEOUT_MS = 8000;
const MAX_RESULTS = 10;

interface RawEntry {
  id?: string;
  title?: string;
  summary?: string;
  published?: string;
  authors?: string[];
  link?: string;
  category?: string;
}

function extractEntries(xml: string): RawEntry[] {
  const entries: RawEntry[] = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  let match: RegExpExecArray | null;
  while ((match = entryRe.exec(xml)) !== null) {
    const block = match[1];
    const idMatch = /<id>([^<]+)<\/id>/.exec(block);
    const titleMatch = /<title>\s*([\s\S]*?)\s*<\/title>/.exec(block);
    const summaryMatch = /<summary>\s*([\s\S]*?)\s*<\/summary>/.exec(block);
    const publishedMatch = /<published>([^<]+)<\/published>/.exec(block);
    const authorRe = /<author>\s*<name>([^<]+)<\/name>/g;
    const authors: string[] = [];
    let am: RegExpExecArray | null;
    while ((am = authorRe.exec(block)) !== null) authors.push(am[1]);
    const linkMatch = /<link[^>]*href="([^"]+)"[^>]*rel="alternate"/.exec(block);
    const categoryMatch = /<category[^>]*term="([^"]+)"/.exec(block);
    entries.push({
      id: idMatch?.[1],
      title: titleMatch?.[1]?.replace(/\s+/g, " ").trim(),
      summary: summaryMatch?.[1]?.replace(/\s+/g, " ").trim(),
      published: publishedMatch?.[1],
      authors,
      link: linkMatch?.[1],
      category: categoryMatch?.[1],
    });
  }
  return entries;
}

export interface ArxivSearchResult {
  arxivId?: string;
  title: string;
  authors: string[];
  year: number | null;
  abstract: string;
  url: string | null;
  category: string | null;
}

function buildResult(raw: RawEntry): ArxivSearchResult {
  const arxivIdMatch = raw.id?.match(/abs\/([^/?]+)$/);
  const arxivId = arxivIdMatch?.[1];
  const year = raw.published ? new Date(raw.published).getUTCFullYear() : null;
  return {
    arxivId,
    title: raw.title ?? "",
    authors: raw.authors ?? [],
    year,
    abstract: (raw.summary ?? "").slice(0, 1200),
    url: raw.link ?? (arxivId ? `https://arxiv.org/abs/${arxivId}` : null),
    category: raw.category ?? null,
  };
}

export async function arxivSearch(
  query: string,
  maxResults = 5
): Promise<Record<string, unknown>> {
  const trimmed = query.trim().slice(0, 500);
  if (!trimmed) return { error: "EMPTY_QUERY" };
  const size = Math.max(1, Math.min(MAX_RESULTS, maxResults));
  const url = `${ARXIV_API}?search_query=all:${encodeURIComponent(trimmed)}&start=0&max_results=${size}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "LumenLab-Agent/1.0" },
    });
    if (!response.ok) {
      return { error: "ARXIV_FAILED", status: response.status };
    }
    const xml = await response.text();
    const entries = extractEntries(xml);
    return {
      query: trimmed,
      results: entries.map(buildResult),
      count: entries.length,
    };
  } catch (error) {
    logger.warn("arxiv.search failed", { error: String(error) });
    return { error: "FETCH_ERROR" };
  } finally {
    clearTimeout(timeout);
  }
}