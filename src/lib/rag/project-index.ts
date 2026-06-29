import { prisma } from "@/lib/db";
import { createTextMessage } from "@/lib/deepseek";
import { getProviderApiKey } from "@/lib/data/provider-access";
export { FILE_CATEGORIES, type FileCategory } from "@/lib/file-categories";
import { invalidateFileSelectCache } from "@/lib/cache/rag-file-select-cache";

interface IndexFile {
  id: string;
  originalName: string;
  category: string | null;
  categoryConfidence: number | null;
  status: string;
  textContent: string | null;
  enhancedContent: string | null;
  processingMetadata: unknown;
}

export interface RefreshProjectIndexInput {
  userId: string;
  projectId: string;
}

export interface MatchProjectIndexInput extends RefreshProjectIndexInput {
  query: string;
  limit?: number;
}

export interface ProjectIndexMatch {
  fileId: string;
  originalName: string;
  category: string | null;
  summary: string;
  keywords: string[];
  score: number;
}

export interface ProjectIndexMatchResult {
  fullLoadFileIds: string[];
  summaryOnly: ProjectIndexMatch[];
  matches: ProjectIndexMatch[];
}

function compactText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalize(value: string) {
  return value.toLowerCase().replace(/\s+/g, "");
}

function summarize(content: string | null, maxLength = 200) {
  const text = compactText(content || "");
  if (!text) return "暂无可检索正文";
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function tokenize(value: string, limit = 18) {
  const terms = new Set<string>();
  const runs = value
    .toLowerCase()
    .match(/[\p{Script=Han}a-z0-9_+-]{2,}/gu) || [];

  for (const run of runs) {
    if (run.length <= 10) {
      terms.add(run);
    } else {
      terms.add(run.slice(0, 10));
      if (/^\p{Script=Han}+$/u.test(run)) {
        for (let i = 0; i < run.length - 1 && terms.size < limit; i += 2) {
          terms.add(run.slice(i, i + 2));
        }
      }
    }
    if (terms.size >= limit) break;
  }

  return [...terms];
}

function fileContent(file: IndexFile) {
  return file.enhancedContent || file.textContent || "";
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function metadataSummary(file: IndexFile) {
  const metadata = metadataRecord(file.processingMetadata);
  return typeof metadata.summary === "string" && metadata.summary.trim()
    ? summarize(metadata.summary, 200)
    : summarize(fileContent(file), 200);
}

function metadataKeywords(file: IndexFile) {
  const metadata = metadataRecord(file.processingMetadata);
  const raw = Array.isArray(metadata.keywords) ? metadata.keywords : null;
  if (raw) {
    const keywords = raw
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 5);
    if (keywords.length > 0) return keywords;
  }
  return tokenize(`${file.originalName} ${file.category || ""} ${fileContent(file)}`, 5);
}

export function buildProjectIndexEntries(files: IndexFile[]) {
  return files.map((file) => {
    const summary = metadataSummary(file);
    const keywords = metadataKeywords(file);
    const category =
      file.category && (file.categoryConfidence ?? 1) >= 0.7
        ? file.category
        : "未分类";

    return {
      fileId: file.id,
      originalName: file.originalName,
      category,
      status: file.status,
      summary,
      keywords,
      line: [
        `- **${file.originalName}** [${file.status}]`,
        `  - ID: ${file.id}`,
        `  - 状态：${file.status}`,
        `  - 分类：${category}`,
        `  - 摘要：${summary}`,
        `  - 标签：${keywords.join("、") || "无"}`,
        `  - 关键术语：${keywords.join("、") || "无"}`,
      ].join("\n"),
    };
  });
}

async function assertProjectAccess(input: RefreshProjectIndexInput) {
  const project = await prisma.project.findFirst({
    where: { id: input.projectId, userId: input.userId },
    select: { id: true },
  });
  if (!project) {
    throw new Error("项目不存在或无访问权限");
  }
}

async function getIndexableFiles(input: RefreshProjectIndexInput): Promise<IndexFile[]> {
  return prisma.fileAsset.findMany({
    where: {
      projectId: input.projectId,
      userId: input.userId,
    },
    orderBy: { createdAt: "desc" },
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
}

export async function refreshProjectIndex(input: RefreshProjectIndexInput) {
  await assertProjectAccess(input);
  const files = await getIndexableFiles(input);
  const entries = buildProjectIndexEntries(files);
  const groups = new Map<string, typeof entries>();
  for (const entry of entries) {
    groups.set(entry.category, [...(groups.get(entry.category) || []), entry]);
  }
  const content = [
    "## 项目文件索引",
    "",
    `项目ID：${input.projectId}`,
    `文件数：${entries.length}`,
    "",
    ...Array.from(groups.entries()).flatMap(([category, group]) => [
      `### ${category}`,
      "",
      ...group.map((entry) => entry.line),
      "",
    ]),
  ].join("\n");

  await prisma.projectIndex.upsert({
    where: { projectId: input.projectId },
    create: { projectId: input.projectId, content },
    update: { content },
  });

  await invalidateFileSelectCache(input.projectId);

  return content;
}

export function fallbackIndexMetadata(input: {
  filename: string;
  content: string | null;
}) {
  const summary = summarize(input.content, 200);
  const keywords = tokenize(`${input.filename} ${input.content || ""}`, 5);
  return { summary, keywords };
}

function parseMetadataJson(value: string) {
  const fenced = value.match(/```json\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced || value.match(/\{[\s\S]*\}/)?.[0] || value;
  const parsed = JSON.parse(candidate) as Record<string, unknown>;
  const summary = typeof parsed.summary === "string"
    ? summarize(parsed.summary, 200)
    : "";
  const keywords = Array.isArray(parsed.keywords)
    ? parsed.keywords
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 5)
    : [];
  if (!summary || keywords.length === 0) {
    throw new Error("Invalid index metadata");
  }
  return { summary, keywords };
}

export async function generateFileIndexMetadata(input: {
  userId: string;
  filename: string;
  content: string | null;
}) {
  const fallback = fallbackIndexMetadata(input);
  if (!input.content?.trim()) return fallback;

  let apiKey: string;
  try {
    apiKey = await getProviderApiKey(input.userId, "deepseek");
  } catch {
    return fallback;
  }

  try {
    const output = await createTextMessage(apiKey, {
      model: "deepseek-v4-flash",
      maxTokens: 500,
      temperature: 0,
      system: "你是课程资料索引器。只能输出 JSON，不要输出解释。",
      prompt: [
        "请为下面的课程资料生成一个不超过 200 个中文字符的摘要，以及 5 个关键词标签。",
        "输出格式：{\"summary\":\"...\",\"keywords\":[\"...\",\"...\",\"...\",\"...\",\"...\"]}",
        "",
        `文件名：${input.filename}`,
        "",
        input.content.slice(0, 6000),
      ].join("\n"),
    });
    return parseMetadataJson(output);
  } catch {
    return fallback;
  }
}

function scoreEntry(entry: ReturnType<typeof buildProjectIndexEntries>[number], query: string) {
  const queryTerms = tokenize(query, 24);
  const normalizedQuery = normalize(query);
  const normalizedName = normalize(entry.originalName);
  let score = 0;

  if (normalizedName && normalizedQuery.includes(normalizedName)) {
    score += 1000;
  }

  const filename = entry.originalName.toLowerCase();
  const summary = entry.summary.toLowerCase();
  const category = entry.category.toLowerCase();
  const keywords = entry.keywords.map((keyword) => keyword.toLowerCase());

  for (const term of queryTerms) {
    if (filename.includes(term)) score += 8;
    if (category.includes(term)) score += 3;
    if (summary.includes(term)) score += 2;
    if (keywords.some((keyword) => keyword.includes(term) || term.includes(keyword))) {
      score += 5;
    }
  }

  return score;
}

export async function matchProjectIndex(input: MatchProjectIndexInput): Promise<ProjectIndexMatchResult> {
  await assertProjectAccess(input);
  const files = await getIndexableFiles(input);
  const entries = buildProjectIndexEntries(
    files.filter((file) => ["parsed", "partial"].includes(file.status))
  );
  const limit = input.limit ?? 5;
  const matches = entries
    .map((entry) => ({
      fileId: entry.fileId,
      originalName: entry.originalName,
      category: entry.category === "未分类" ? null : entry.category,
      summary: entry.summary,
      keywords: entry.keywords,
      score: scoreEntry(entry, input.query),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.originalName.localeCompare(b.originalName, "zh-Hans-CN"));

  return {
    fullLoadFileIds: matches.slice(0, limit).map((match) => match.fileId),
    summaryOnly: matches.slice(limit),
    matches,
  };
}
