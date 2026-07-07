import { prisma } from "@/lib/db";
import { buildProjectIndexEntries } from "@/lib/rag/project-index";

interface PrefetchFile {
  id: string;
  originalName: string;
  category: string | null;
  categoryConfidence: number | null;
  status: string;
  textContent: string | null;
  enhancedContent: string | null;
  processingMetadata: unknown;
}

export interface PrefetchProjectMaterialInput {
  userId: string;
  projectId: string;
  selectedFileIds: string[];
  prompt: string;
  maxChars?: number;
}

export type PrefetchProjectMaterialResult =
  | {
      status: "ok";
      context: string;
      sources: Array<{ fileAssetId: string; title: string; snippet: string }>;
      usedFileIds: string[];
      readableFileCount: number;
      totalCandidateFileCount: number;
      selectedOnly: boolean;
    }
  | {
      status: "no_readable_files" | "selected_unreadable";
      message: string;
      readableFileCount: number;
      totalCandidateFileCount: number;
      selectedOnly: boolean;
    };

const DEFAULT_MAX_PREFETCH_CHARS = 180_000;
const MIN_SNIPPET_CHARS = 300;
const MAX_SNIPPET_CHARS = 1_400;

function compactText(value: string | null | undefined) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function fileContent(file: PrefetchFile) {
  return file.enhancedContent || file.textContent || "";
}

function readableFiles(files: PrefetchFile[]) {
  return files.filter((file) => {
    const content = fileContent(file);
    return Boolean(content.trim()) && ["parsed", "partial"].includes(file.status);
  });
}

function snippetFor(file: PrefetchFile, maxChars: number) {
  const text = compactText(fileContent(file));
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}...`;
}

function snippetBudget(fileCount: number, remainingChars: number) {
  if (fileCount <= 0) return 0;
  if (remainingChars <= 0) return MIN_SNIPPET_CHARS;
  return Math.max(
    MIN_SNIPPET_CHARS,
    Math.min(MAX_SNIPPET_CHARS, Math.floor(remainingChars / fileCount))
  );
}

function orderSelectedFiles(files: PrefetchFile[], selectedFileIds: string[]) {
  if (selectedFileIds.length === 0) return files;
  const order = new Map(selectedFileIds.map((id, index) => [id, index]));
  return [...files].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

export async function prefetchProjectMaterialForQuickTask(
  input: PrefetchProjectMaterialInput
): Promise<PrefetchProjectMaterialResult> {
  const selectedFileIds = [...new Set(input.selectedFileIds)];
  const selectedOnly = selectedFileIds.length > 0;
  const files = await prisma.fileAsset.findMany({
    where: {
      userId: input.userId,
      projectId: input.projectId,
      ...(selectedOnly ? { id: { in: selectedFileIds } } : {}),
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      originalName: true,
      category: true,
      categoryConfidence: true,
      status: true,
      textContent: true,
      enhancedContent: true,
      processingMetadata: true,
    },
  });

  const orderedFiles = orderSelectedFiles(files, selectedFileIds);
  const readable = readableFiles(orderedFiles);
  if (readable.length === 0) {
    return {
      status: selectedOnly ? "selected_unreadable" : "no_readable_files",
      message: selectedOnly
        ? "选中的资料尚未解析完成或没有可读取文本，请等待解析完成或重新解析后再试。"
        : "当前项目没有可读取的已解析资料，请先上传资料并等待解析完成。",
      readableFileCount: 0,
      totalCandidateFileCount: files.length,
      selectedOnly,
    };
  }

  const entries = buildProjectIndexEntries(readable);
  const fileCards = entries.map((entry) => entry.line).join("\n\n");
  const maxChars = input.maxChars ?? DEFAULT_MAX_PREFETCH_CHARS;
  const header = [
    "# 项目资料预取结果",
    "",
    selectedOnly
      ? `覆盖范围：用户显式选中的 ${readable.length} 份可读资料。`
      : `覆盖范围：当前项目内全部 ${readable.length} 份可读资料。`,
    `候选文件数：${files.length}`,
    `用户任务：${input.prompt}`,
    "",
    "## 全量文件卡片",
    "",
    fileCards,
  ].join("\n");

  const remaining = maxChars - header.length;
  const perFileSnippetChars = snippetBudget(readable.length, remaining);
  const snippets = readable.map((file, index) => {
    const snippet = snippetFor(file, perFileSnippetChars);
    return [
      `### 资料 ${index + 1}：${file.originalName}`,
      "",
      `文件ID：${file.id}`,
      `状态：${file.status}`,
      "",
      snippet,
    ].join("\n");
  });

  const context = [
    header,
    "",
    "## 每份资料代表片段",
    "",
    ...snippets,
    "",
    "## 使用要求",
    "",
    "- 已覆盖上述全部可读资料，不要声称没有收到项目资料。",
    "- 如果图表或答案需要压缩，只压缩细节，不要静默忽略文件覆盖范围。",
    "- 回答中应说明覆盖了多少份资料；来源会在回答底部展示。",
  ].join("\n");

  return {
    status: "ok",
    context,
    sources: entries.map((entry) => ({
      fileAssetId: entry.fileId,
      title: entry.originalName,
      snippet: entry.summary,
    })),
    usedFileIds: entries.map((entry) => entry.fileId),
    readableFileCount: readable.length,
    totalCandidateFileCount: files.length,
    selectedOnly,
  };
}
