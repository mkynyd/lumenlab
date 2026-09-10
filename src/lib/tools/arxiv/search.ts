/**
 * arxiv.search — arXiv API 关键词搜索
 *
 * 文档：http://export.arxiv.org/api_help/
 * 仅搜索 cs.* / stat.ML / math.* 类目，按用户 query 拼接；
 * 任何 401/403/超时返回 {error}。
 *
 * 超时/重试策略（bounded，与 Sciverse transport 对齐）：
 * - 单次尝试 8s 超时，超时或网络错误允许一次 300ms 退避后的重试；
 * - 父 AbortSignal（用户取消 / 工具硬超时）立即终止，绝不进入重试；
 * - 日志只记录 provider、耗时、错误类别与重试次数，不记录检索 query。
 */

import { logger } from "@/lib/logger";

const ARXIV_API = "http://export.arxiv.org/api/query";
const FETCH_TIMEOUT_MS = 8000;
const RETRY_BACKOFF_MS = 300;
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

export interface ArxivSearchOptions {
  /** 父级取消信号（用户取消 / Tool Runner 硬超时）；aborted 时不重试。 */
  signal?: AbortSignal;
  /** 测试注入；默认全局 fetch。 */
  fetchImpl?: typeof fetch;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function errorClass(error: unknown): string {
  if (error instanceof Error) return error.name;
  return "unknown";
}

export async function arxivSearch(
  query: string,
  maxResults = 5,
  options: ArxivSearchOptions = {}
): Promise<Record<string, unknown>> {
  const trimmed = query.trim().slice(0, 500);
  if (!trimmed) return { error: "EMPTY_QUERY" };
  const size = Math.max(1, Math.min(MAX_RESULTS, maxResults));
  const url = `${ARXIV_API}?search_query=all:${encodeURIComponent(trimmed)}&start=0&max_results=${size}`;
  const fetchImpl = options.fetchImpl ?? fetch;

  const attempt = async (): Promise<Response> => {
    const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    return fetchImpl(url, {
      signal,
      headers: { "user-agent": "LumenLab-Agent/1.0" },
    });
  };

  const startedAt = Date.now();
  let response: Response;
  try {
    response = await attempt();
  } catch (error) {
    // 父信号取消：立即终止，不重试，不吞掉取消语义。
    if (options.signal?.aborted) {
      logger.warn("arxiv.search aborted by caller", { provider: "arxiv", durationMs: Date.now() - startedAt, errorClass: errorClass(error), retried: false });
      return { error: "FETCH_ERROR" };
    }
    // 超时/网络瞬时错误：有界退避后最多重试一次。
    logger.warn("arxiv.search attempt failed; retrying once", { provider: "arxiv", durationMs: Date.now() - startedAt, errorClass: errorClass(error), retried: false });
    await sleep(RETRY_BACKOFF_MS);
    try {
      response = await attempt();
    } catch (retryError) {
      logger.warn("arxiv.search failed after one retry", { provider: "arxiv", durationMs: Date.now() - startedAt, errorClass: errorClass(retryError), retried: true });
      return { error: "FETCH_ERROR" };
    }
  }
  try {
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
    logger.warn("arxiv.search failed", { provider: "arxiv", durationMs: Date.now() - startedAt, errorClass: errorClass(error) });
    return { error: "FETCH_ERROR" };
  }
}