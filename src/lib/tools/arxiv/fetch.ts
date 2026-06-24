/**
 * arxiv.fetch — 抓取 arxiv 公开页面（abs / pdf URL）
 *
 * 复用 web.fetch 的白名单 / 超时 / 大小限制；
 * 区别在于明确语义（arxiv 来源）+ 仅返回 text/plain 或 abs HTML。
 */

import { webFetch } from "../web/fetch";

export async function arxivFetch(
  url: string
): Promise<Record<string, unknown>> {
  const result = await webFetch(url);
  // 包装一层让前端 timeline 显示 skill 名
  return { source: "arxiv", ...result };
}