/**
 * arxiv.read — 拉取单篇论文元数据 + 摘要
 *
 * 支持 arxiv_id（2401.12345 或 abs/2401.12345 或完整 URL）。
 */

import { logger } from "@/lib/logger";
import { arxivSearch } from "./search";

const ARXIV_API = "http://export.arxiv.org/api/query";
const FETCH_TIMEOUT_MS = 8000;

function parseArxivId(input: string): string | null {
  const trimmed = input.trim();
  const urlMatch = trimmed.match(/arxiv\.org\/(?:abs|pdf)\/([^v\s?]+)(?:\.pdf)?/);
  if (urlMatch) return urlMatch[1];
  const idMatch = trimmed.match(/^(\d{4}\.\d{4,5}(v\d+)?|\w+-\w+\/\d{7})$/);
  return idMatch ? idMatch[1] : null;
}

export async function arxivRead(
  arxivIdOrUrl: string
): Promise<Record<string, unknown>> {
  const id = parseArxivId(arxivIdOrUrl);
  if (!id) {
    return { error: "INVALID_ARXIV_ID", input: arxivIdOrUrl };
  }
  const url = `${ARXIV_API}?id_list=${encodeURIComponent(id)}`;
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
    const entryMatch = /<entry>([\s\S]*?)<\/entry>/.exec(xml);
    if (!entryMatch) {
      return { error: "NOT_FOUND", arxivId: id };
    }
    const block = entryMatch[1];
    const title = /<title>\s*([\s\S]*?)\s*<\/title>/.exec(block)?.[1]?.replace(/\s+/g, " ").trim() ?? "";
    const summary = /<summary>\s*([\s\S]*?)\s*<\/summary>/.exec(block)?.[1]?.replace(/\s+/g, " ").trim() ?? "";
    const published = /<published>([^<]+)<\/published>/.exec(block)?.[1];
    const authorRe = /<author>\s*<name>([^<]+)<\/name>/g;
    const authors: string[] = [];
    let am: RegExpExecArray | null;
    while ((am = authorRe.exec(block)) !== null) authors.push(am[1]);
    const year = published ? new Date(published).getUTCFullYear() : null;
    return {
      arxivId: id,
      title,
      authors,
      year,
      abstract: summary.slice(0, 4000),
      url: `https://arxiv.org/abs/${id}`,
      pdfUrl: `https://arxiv.org/pdf/${id}.pdf`,
    };
  } catch (error) {
    logger.warn("arxiv.read failed", { error: String(error), id });
    // 兜底：失败时按 search 走一次（仅在 ID 形如 4 位点分时有效）
    if (/^\d{4}\.\d{4,5}/.test(id)) {
      return arxivSearch(id, 1);
    }
    return { error: "FETCH_ERROR", arxivId: id };
  } finally {
    clearTimeout(timeout);
  }
}