import type {
  ProjectFile,
  VectorLibraryGraph,
  VectorLibraryLink,
  VectorLibraryNode,
} from "@/lib/api/types";

const MAX_TOPICS = 20;
const MIN_TERM_LENGTH = 2;
const MIN_FILES_PER_TOPIC = 2;

const STOPWORDS = new Set([
  // 中文
  "的",
  "了",
  "在",
  "是",
  "我",
  "有",
  "和",
  "就",
  "不",
  "人",
  "都",
  "一",
  "一个",
  "上",
  "也",
  "很",
  "到",
  "说",
  "要",
  "去",
  "你",
  "会",
  "着",
  "没有",
  "看",
  "好",
  "自己",
  "这",
  "那",
  "使用",
  "信息",
  "内容",
  "提供",
  "中的",
  "进行",
  "不同",
  "相关",
  "可以",
  "以及",
  "通过",
  "主要",
  "包括",
  "需要",
  "对于",
  // 英文
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "with",
  "by",
  "from",
  "as",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "can",
  "this",
  "that",
  "these",
  "those",
  "it",
  "its",
  "they",
  "them",
  "their",
  "we",
  "us",
  "our",
  "you",
  "your",
]);

export interface RawChunk {
  id: string;
  content: string;
  chunkIndex: number;
  tokenCount?: number | null;
}

export interface RawChunkMap {
  [fileId: string]: RawChunk[];
}

function tokenize(text: string): string[] {
  const terms: string[] = [];
  // Use language-aware word segmentation instead of arbitrary overlapping n-grams.
  // Adjacent meaningful words also form a phrase candidate (e.g. 网络 + 安全).
  const segmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });
  const chineseWords = [...segmenter.segment(text)]
    .filter((item) => item.isWordLike && /^[\u4e00-\u9fa5]+$/.test(item.segment))
    .map((item) => item.segment);
  for (let index = 0; index < chineseWords.length; index += 1) {
    const word = chineseWords[index];
    if (word.length >= MIN_TERM_LENGTH && !STOPWORDS.has(word)) terms.push(word);
    const next = chineseWords[index + 1];
    if (
      next &&
      !STOPWORDS.has(word) &&
      !STOPWORDS.has(next) &&
      word.length + next.length >= MIN_TERM_LENGTH &&
      word.length + next.length <= 8
    ) {
      terms.push(`${word}${next}`);
    }
  }
  // English words
  const english = text.toLowerCase().match(/[a-z]{3,}/g) || [];
  terms.push(...english);
  return terms.filter((t) => !STOPWORDS.has(t));
}

export function buildVectorLibraryGraph(
  files: ProjectFile[],
  chunksByFile: RawChunkMap
): VectorLibraryGraph {
  const nodes: VectorLibraryNode[] = [];
  const links: VectorLibraryLink[] = [];

  // File nodes
  for (const file of files) {
    nodes.push({
      id: file.id,
      type: "file",
      label: file.originalName || file.filename,
      radius: 16,
      fileId: file.id,
      status: file.status,
      processingError: file.processingError ?? null,
      keywords: file.category ? [file.category] : undefined,
    });
  }

  // Chunk nodes + links to file
  let chunkCount = 0;
  for (const file of files) {
    const chunks = chunksByFile[file.id] || [];
    for (const chunk of chunks) {
      chunkCount++;
      nodes.push({
        id: chunk.id,
        type: "chunk",
        label: `片段 ${chunk.chunkIndex + 1}`,
        radius: 5,
        fileId: file.id,
        chunkIndex: chunk.chunkIndex,
        content: chunk.content.slice(0, 240),
        keywords: tokenize(chunk.content).slice(0, 6),
      });
      links.push({
        source: file.id,
        target: chunk.id,
        strength: 0.6,
      });
    }
  }

  // Topic nodes derived from shared terms across parsed/partial files
  const fileContents = files
    .filter((f) => f.status === "parsed" || f.status === "partial")
    .map((f) => ({
      id: f.id,
      text: (chunksByFile[f.id] || []).map((c) => c.content).join(" "),
    }));

  const termFiles = new Map<string, Set<string>>();
  for (const { id, text } of fileContents) {
    const seen = new Set<string>();
    for (const term of tokenize(text)) {
      if (!seen.has(term)) {
        seen.add(term);
        const set = termFiles.get(term) || new Set<string>();
        set.add(id);
        termFiles.set(term, set);
      }
    }
  }

  const topicTerms = Array.from(termFiles.entries())
    .filter(([, set]) => set.size >= MIN_FILES_PER_TOPIC)
    .sort((a, b) =>
      b[1].size - a[1].size || b[0].length - a[0].length || a[0].localeCompare(b[0])
    )
    .slice(0, MAX_TOPICS)
    .map(([term]) => term);

  for (const term of topicTerms) {
    const fileIds = termFiles.get(term)!;
    const topicId = `topic:${term}`;
    nodes.push({
      id: topicId,
      type: "topic",
      label: term,
      radius: 24,
      keywords: [term],
    });
    for (const fileId of fileIds) {
      links.push({
        source: topicId,
        target: fileId,
        strength: 0.35,
      });
    }
  }

  return {
    nodes,
    links,
    topics: topicTerms,
    stats: {
      fileCount: files.length,
      chunkCount,
      topicCount: topicTerms.length,
    },
  };
}
