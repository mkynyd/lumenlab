/**
 * Skills Executor — 执行 client-side 工具调用并返回结果。
 */

import { prisma } from "@/lib/db";
import type { SkillContext } from "@/lib/skills/registry";
import {
  SKILL_SEARCH_PROJECT_FILES,
  SKILL_LIST_PROJECT_FILES,
  SKILL_READ_FILE_CONTENT,
} from "@/lib/skills/registry";

// ============================================================
// Skill Implementations
// ============================================================

async function executeSearchProjectFiles(
  input: Record<string, unknown>,
  context: SkillContext
): Promise<string> {
  const query = (input.query as string) || "";
  const maxResults = Math.min((input.maxResults as number) || 5, 10);

  if (!context.projectId) {
    return "当前对话没有关联项目，无法搜索项目文件。请先创建或切换到项目。";
  }

  const files = await prisma.fileAsset.findMany({
    where: {
      projectId: context.projectId,
      userId: context.userId,
      status: "parsed",
      textContent: { not: null },
    },
    select: {
      id: true,
      originalName: true,
      textContent: true,
      category: true,
    },
    take: 50,
  });

  if (files.length === 0) {
    return "当前项目中暂无已解析的文件。请先上传并解析文件。";
  }

  // Simple keyword matching (case-insensitive)
  const keywords = query.toLowerCase().split(/\s+/).filter(Boolean);
  const results: Array<{ file: string; snippet: string; score: number }> = [];

  for (const file of files) {
    if (!file.textContent) continue;
    const content = file.textContent;
    const lowerContent = content.toLowerCase();

    let score = 0;
    for (const kw of keywords) {
      const count = (lowerContent.match(new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
      score += count;
    }

    if (score > 0) {
      // Extract relevant snippet (200 chars around first match)
      const firstMatchIndex = lowerContent.indexOf(keywords[0]);
      const start = Math.max(0, firstMatchIndex - 100);
      const snippet = content.slice(start, start + 300).trim();

      results.push({
        file: file.originalName,
        snippet: (start > 0 ? "..." : "") + snippet + (start + 300 < content.length ? "..." : ""),
        score,
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  const top = results.slice(0, maxResults);

  if (top.length === 0) {
    return `在 ${files.length} 个文件中未找到与 "${query}" 匹配的内容。请尝试其他关键词。`;
  }

  return top
    .map(
      (r, i) =>
        `[${i + 1}] 文件: ${r.file} (匹配度: ${r.score})\n${r.snippet}`
    )
    .join("\n\n---\n\n");
}

async function executeListProjectFiles(
  _input: Record<string, unknown>,
  context: SkillContext
): Promise<string> {
  if (!context.projectId) {
    return "当前对话没有关联项目。";
  }

  const files = await prisma.fileAsset.findMany({
    where: {
      projectId: context.projectId,
      userId: context.userId,
    },
    select: {
      id: true,
      originalName: true,
      mimeType: true,
      status: true,
      category: true,
      size: true,
    },
    orderBy: { createdAt: "desc" },
  });

  if (files.length === 0) {
    return "当前项目中没有文件。";
  }

  return files
    .map(
      (f) =>
        `- [${f.id.slice(0, 8)}] ${f.originalName} · ${f.status} · ${(f.size / 1024).toFixed(1)}KB` +
        (f.category ? ` · ${f.category}` : "")
    )
    .join("\n");
}

async function executeReadFileContent(
  input: Record<string, unknown>,
  context: SkillContext
): Promise<string> {
  const fileId = input.fileId as string;
  if (!fileId) return "请提供文件 ID。";

  const file = await prisma.fileAsset.findFirst({
    where: {
      id: { startsWith: fileId },
      userId: context.userId,
      ...(context.projectId ? { projectId: context.projectId } : {}),
    },
    select: {
      originalName: true,
      textContent: true,
      status: true,
    },
  });

  if (!file) return `未找到文件 (ID: ${fileId})。`;
  if (file.status !== "parsed" || !file.textContent) {
    return `文件 "${file.originalName}" 尚未解析完成，当前状态: ${file.status}。`;
  }

  const content = file.textContent.slice(0, 8000);
  const truncated = content.length < (file.textContent?.length || 0) ? "\n\n[... 内容已截断，仅展示前 8000 字符]" : "";

  return `文件: ${file.originalName}\n\n${content}${truncated}`;
}

// ============================================================
// Skill Executor
// ============================================================

const SKILL_EXECUTORS: Record<string, (input: Record<string, unknown>, context: SkillContext) => Promise<string>> = {
  search_project_files: executeSearchProjectFiles,
  list_project_files: executeListProjectFiles,
  read_file_content: executeReadFileContent,
};

export async function executeSkill(
  name: string,
  input: Record<string, unknown>,
  context: SkillContext
): Promise<string> {
  const executor = SKILL_EXECUTORS[name];
  if (!executor) {
    return `未知工具: ${name}`;
  }

  try {
    return await executor(input, context);
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    return `工具 ${name} 执行失败: ${message}`;
  }
}
