import type { AgentSource } from "../sources";

export interface ConversationState {
  id: string;
  userId: string;
  projectId: string | null;
  model: string;
  modelLock: string | null;
  thinkingEnabled: boolean;
  activeSkillId: string | null;
  skillDisabled: boolean;
}

export interface ConversationHistoryMessage {
  id: string;
  role: string;
  content: string;
  /**
   * 任务 08.6：该消息已绑定的图片附件引用（只含资源定位，不含字节）。
   * 新回合按需重新鉴权读取，用于"接着上次那张图继续问"。
   */
  attachments?: HistoryAttachmentRef[];
}

export interface HistoryAttachmentRef {
  id: string;
  originalName: string;
  mimeType: string;
  storageProvider: string;
  storagePath: string;
  contentHash: string | null;
}

export interface ConversationPersistence {
  findOwnedConversation(input: {
    conversationId: string;
    userId: string;
  }): Promise<ConversationState | null>;
  createConversation(input: {
    userId: string;
    projectId?: string;
    title: string;
    model: string;
    thinkingEnabled: boolean;
  }): Promise<ConversationState>;
  updateModelPreferences(input: {
    conversationId: string;
    model: string;
    thinkingEnabled: boolean;
  }): Promise<ConversationState>;
  lockModel(input: {
    conversationId: string;
    provider: string;
  }): Promise<ConversationState>;
  updateSkillState(input: {
    conversationId: string;
    activeSkillId: string | null;
    activeSkillVersion: string | null;
    activeSkillSource: string | null;
    activeSkillStatus: string | null;
    skillDisabled?: boolean;
  }): Promise<ConversationState>;
  recordSkillActivation(input: {
    conversationId: string;
    skillId: string;
    version: string;
    source: string;
    statusAtActivation: string;
    confidence: number;
    reason: string;
    missingInfo: string[];
  }): Promise<void>;
  deactivateSkill(input: {
    conversationId: string;
    skillId: string;
  }): Promise<void>;
  loadHistory(
    conversationId: string,
    excludeMessageIds?: string[]
  ): Promise<ConversationHistoryMessage[]>;
  createUserMessage(input: {
    conversationId: string;
    content: string;
  }): Promise<{ id: string }>;
  createContextSummary(input: {
    conversationId: string;
    content: string;
    compressedCount: number;
  }): Promise<{ id: string }>;
  markMessagesCompressed(input: {
    conversationId: string;
    messageIds: string[];
    replacedBySummaryId: string;
  }): Promise<void>;
  createAssistantMessage(input: {
    conversationId: string;
    sources: AgentSource[];
  }): Promise<{ id: string }>;
  completeAssistantMessage(input: {
    messageId: string;
    content: string;
    reasoningContent: string | null;
    tokenCount: number | null;
    provider: string;
    cacheHitTokens: number | null;
    cacheMissTokens: number | null;
    sources: AgentSource[];
  }): Promise<void>;
  deleteMessage(messageId: string): Promise<void>;
  updateTitle(input: {
    conversationId: string;
    title: string;
  }): Promise<void>;
  touchConversation(conversationId: string): Promise<void>;
}
