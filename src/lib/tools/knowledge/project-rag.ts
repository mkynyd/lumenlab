/**
 * 项目知识库检索
 *
 * MVP：用关键词扫描已解析文件 textContent 的简单匹配；后续替换为 vector-store 检索。
 */

import { prisma } from "@/lib/db";

export function extractSearchKeywords(query: string) {
  const lower = query.toLowerCase();
  const keywords = lower
    .split(/[^\p{L}\p{N}_+-]+/u)
    .map((k) => k.trim())
    .filter((k) => k.length >= 2);

  for (const match of lower.matchAll(/\p{Script=Han}{2,}/gu)) {
    const text = match[0];
    for (let i = 0; i < text.length - 1; i += 1) {
      keywords.push(text.slice(i, i + 2));
    }
  }

  return [...new Set(keywords)].slice(0, 80);
}

export async function ragSearch(
  userId: string,
  projectId: string,
  query: string,
  maxResults = 5
): Promise<Record<string, unknown>> {
  const keywords = extractSearchKeywords(query);
  if (keywords.length === 0) {
    return { hits: [], query };
  }
  const files = await prisma.fileAsset.findMany({
    where: {
      userId,
      projectId,
      status: "parsed",
      textContent: { not: null },
    },
    select: { id: true, originalName: true, textContent: true },
    take: 50,
  });
  const results: Array<{ file: string; fileId: string; snippet: string; score: number }> = [];
  for (const file of files) {
    if (!file.textContent) continue;
    const lower = file.textContent.toLowerCase();
    let score = 0;
    for (const kw of keywords) {
      const re = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
      const matches = lower.match(re);
      score += matches ? matches.length : 0;
    }
    if (score === 0) continue;
    const idx = lower.indexOf(keywords[0]);
    const start = Math.max(0, idx - 80);
    const snippet = file.textContent
      .slice(start, start + 250)
      .trim();
    results.push({
      file: file.originalName,
      fileId: file.id,
      snippet: (start > 0 ? "…" : "") + snippet,
      score,
    });
  }
  results.sort((a, b) => b.score - a.score);
  return {
    query,
    hits: results.slice(0, maxResults),
    totalMatched: results.length,
  };
}
