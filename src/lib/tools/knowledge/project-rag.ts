/**
 * 项目知识库检索
 *
 * MVP：用关键词扫描已解析文件 textContent 的简单匹配；后续替换为 vector-store 检索。
 */

import { prisma } from "@/lib/db";

export async function ragSearch(
  userId: string,
  projectId: string,
  query: string,
  maxResults = 5
): Promise<Record<string, unknown>> {
  const keywords = query
    .toLowerCase()
    .split(/\s+/)
    .map((k) => k.trim())
    .filter(Boolean);
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