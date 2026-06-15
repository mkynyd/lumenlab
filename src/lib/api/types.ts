export interface ConversationSummary {
  id: string;
  title: string;
  model: string;
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
  enhancementStatus?: string;
  processingMetadata?: Record<string, unknown> | null;
  createdAt: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  description: string | null;
  type: string;
  defaultModel?: string | null;
  updatedAt: string;
  _count: { conversations: number; files: number };
}

export interface ProjectDetail extends ProjectSummary {
  files: ProjectFile[];
  conversations: ConversationSummary[];
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
}

export type ApiKeyProvider = "deepseek" | "minimax";

export interface ApiKeyInfo {
  hasKey: boolean;
  keyPrefix?: string;
  createdAt?: string;
}

export interface ApiKeyResponse {
  providers: Partial<Record<ApiKeyProvider, ApiKeyInfo>>;
}
