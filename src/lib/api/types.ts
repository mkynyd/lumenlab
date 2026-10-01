import type { AgentSource } from "@/lib/agent/sources";
import type { AssistantProcessTrace } from "@/lib/agent/assistant-process";
import type { ChatAttachmentDto } from "@/lib/chat/message-attachments";
export interface ConversationSummary {
  id: string;
  title: string;
  model: string;
  modelLock?: string | null;
  thinkingEnabled?: boolean;
  projectId?: string | null;
  updatedAt: string;
}

export interface ConversationMessage {
  id: string;
  role: string;
  content: string;
  reasoningContent?: string | null;
  tokenCount?: number | null;
  cacheHitTokens?: number | null;
  cacheMissTokens?: number | null;
  sources?: AgentSource[] | null;
  process?: AssistantProcessTrace;
  /** 任务 08：已持久化的附件（含同源鉴权 URL 与 kind 分类）。 */
  attachments?: ChatAttachmentDto[];
  createdAt?: string;
}

export interface ConversationDetail extends ConversationSummary {
  messages: ConversationMessage[];
}

export interface ProjectFile {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  status: string;
  category?: string | null;
  categoryConfidence?: number | null;
  enhancementStatus?: string;
  processingMetadata?: Record<string, unknown> | null;
  processingError?: string | null;
  createdAt: string;
}

export type VectorNodeType = "topic" | "file" | "chunk";

export interface VectorLibraryNode {
  id: string;
  type: VectorNodeType;
  label: string;
  radius: number;
  /** fileId for file nodes; parent file id for chunk nodes */
  fileId?: string;
  chunkIndex?: number;
  status?: string;
  /** present on topic/file nodes and chunk nodes */
  keywords?: string[];
  /** present on chunk nodes */
  content?: string;
  /** present on file nodes */
  processingError?: string | null;
  /** D3 simulation mutable state */
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  index?: number;
}

export interface VectorLibraryLink {
  source: string;
  target: string;
  strength: number;
}

export interface VectorLibraryGraph {
  nodes: VectorLibraryNode[];
  links: VectorLibraryLink[];
  topics: string[];
  stats: {
    fileCount: number;
    chunkCount: number;
    topicCount: number;
  };
}

export interface QuickActionSummary {
  id: string;
  title: string;
  prompt: string;
  isSystem: boolean;
  sortOrder: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  description: string | null;
  type: string;
  defaultModel?: string | null;
  thinkingEnabled?: boolean;
  updatedAt: string;
  _count: { conversations: number; files: number };
}

export interface ResearchWorkspaceSummary {
  id: string;
  name: string;
  description: string | null;
  domainProfileKey: string;
  budgetProfile: "quick" | "deep" | "comprehensive";
  status: string;
  project?: { id: string; name: string } | null;
  runs: Array<{ id: string; question: string; status: string; createdAt: string; updatedAt: string }>;
  _count: { runs: number; sources: number; evidence: number };
  createdAt: string;
  updatedAt: string;
}

export interface PaperWorkspaceSummary {
  id: string;
  name: string;
  description: string | null;
  status: string;
  project?: { id: string; name: string } | null;
  document?: { id: string; title: string; updatedAt: string; currentVersionId: string | null } | null;
  _count: { materials: number; references: number };
  createdAt: string;
  updatedAt: string;
}

export interface ProjectDetail extends ProjectSummary {
  files: ProjectFile[];
  conversations: ConversationSummary[];
  quickActions?: QuickActionSummary[];
}

export interface ArtifactSummary {
  id: string;
  title: string;
  type: string;
  format?: string;
  conversationId?: string | null;
  messageId?: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface ArtifactDetail extends ArtifactSummary {
  content: string;
  metadata?: Record<string, unknown> | null;
}

export interface ConversionSummary {
  id: string;
  title: string;
  originalName: string;
  status: string;
  pageCount: number | null;
  createdAt: string;
}

export interface ConversionDetail extends ConversionSummary {
  markdownContent: string;
  assets: Array<{ id: string; relativePath: string }>;
  fileSize: number | null;
  metadata: Record<string, unknown> | null;
  updatedAt: string;
}

/**
 * 跨项目资料库（`GET /api/files`）的契约。
 *
 * 这几个联合类型是唯一真源：服务端查询层用 `satisfies` 把筛选常量绑过来，
 * 客户端不再重复声明，任何一侧新增取值都会在编译期暴露。
 */
export type FileLibraryMimeGroup =
  | "document"
  | "image"
  | "video"
  | "text"
  | "data"
  | "code";

export type FileLibraryStatus =
  | "parsing"
  | "parsed"
  | "warning"
  | "index-incomplete"
  | "failed";

export type FileLibrarySort = "relevance" | "recent" | "name";

/** 命中来源，供列表决定高亮哪一段。 */
export type FileLibraryMatchKind = "filename" | "project" | "category" | "content";

export interface FileLibraryItem {
  id: string;
  originalName: string;
  filename: string;
  mimeType: string;
  size: number;
  status: string;
  category: string | null;
  categoryConfidence: number | null;
  projectId: string | null;
  projectName: string | null;
  createdAt: string;
  updatedAt: string;
  hasParsedContent: boolean;
  hasEnhancedContent: boolean;
  warningCount: number;
  embeddingStatus: string | null;
  matchKind: FileLibraryMatchKind | null;
  /** 正文命中的上下文片段，只在正文命中时有值。 */
  snippet: string | null;
}

export interface FileLibraryPage {
  files: FileLibraryItem[];
  nextCursor: string | null;
}
