import type { AgentSource } from "@/lib/agent/sources";
import type { AssistantProcessTrace } from "@/lib/agent/assistant-process";
import type {
  AssistanceLevel,
  ContentFreshness,
  EvaluationVerdict,
  MasteryState,
  PracticeItemOptionDto,
  PracticeItemPublicDto,
  ReviewState,
} from "@/lib/learning/contracts";
import type {
  AttemptSubmissionResult,
  KnowledgeMapDto,
  LearningErrorTypeCorrectionDto,
  LearningGoalDto,
  LearningGoalRevisionDto,
  LearningHistoryDto,
  LearningHistoryEvidenceDto,
  LearningHistoryEvaluationDto,
  LearningHistoryPointDto,
  LearningInteractionDto,
  LearningProfileResetDto,
  LearningProfileResetScope,
  LearningProgressDto,
  LearningRegradeDto,
  LearningScopeDto,
  LearningSessionDto,
  StudyPackDto,
  StudyPackOutlineItemDto,
  StudyPackSectionDto,
} from "@/lib/learning/services/learning-service";

export type {
  AssistanceLevel,
  ContentFreshness,
  EvaluationVerdict,
  KnowledgeMapDto,
  LearningErrorTypeCorrectionDto,
  LearningGoalDto,
  LearningGoalRevisionDto,
  LearningHistoryDto,
  LearningHistoryEvidenceDto,
  LearningHistoryEvaluationDto,
  LearningHistoryPointDto,
  LearningInteractionDto,
  LearningProfileResetDto,
  LearningProfileResetScope,
  LearningProgressDto,
  LearningRegradeDto,
  LearningScopeDto,
  MasteryState,
  PracticeItemOptionDto,
  PracticeItemPublicDto,
  ReviewState,
  StudyPackDto,
  StudyPackOutlineItemDto,
  StudyPackSectionDto,
};

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

export type LearningMaterialMode = "project_corpus" | "selected_files";

export type PracticeItemClientDto = PracticeItemPublicDto;
export type PracticeOptionDto = PracticeItemOptionDto;
export type LearningSessionItemClientDto = LearningSessionDto["items"][number];
export type LearningSessionClientDto = LearningSessionDto;

/** Post-submit feedback; answer criteria never cross the public boundary. */
export interface ItemFeedbackDto {
  practiceItem: PracticeItemPublicDto;
  explanation: string | null;
}

export interface HintResultDto {
  interaction: LearningInteractionDto;
  hint: string;
}

export interface AnswerExposureResultDto {
  interaction: LearningInteractionDto;
  feedback: ItemFeedbackDto;
}

export type AttemptEvaluationDto = AttemptSubmissionResult["evaluation"];
export type AttemptResultDto = AttemptSubmissionResult;
export type LearningProgressPointDto = LearningProgressDto;

export interface LearningProgressSummaryDto {
  total: number;
  new: number;
  learning: number;
  mastered: number;
  due: number;
  needsRevalidation: number;
  unsupported: number;
}

export interface LearningProgressResponse {
  summary: LearningProgressSummaryDto;
  points: LearningProgressPointDto[];
}

export type ReviewEntryDto = LearningProgressPointDto & {
  reviewState: "due";
};

export interface ReviewListResponse {
  reviews: ReviewEntryDto[];
}

export interface WrongAnswerAttemptDto {
  id: string;
  answer: unknown;
  assistanceLevel: AssistanceLevel;
  spacingSeconds: number;
  submittedAt: string;
  evaluations: AttemptEvaluationDto[];
}

export interface WrongAnswerItemDto {
  policyVersion: string;
  itemLineageId: string;
  status: "resolved" | "unresolved";
  latestVerdict: EvaluationVerdict;
  triggeringAttemptIds: readonly string[];
  resolutionAttemptIds: readonly string[];
  feedback: ItemFeedbackDto;
  knowledgePoints: Array<{
    id: string;
    lineageId: string;
    name: string;
  }>;
  attempts: WrongAnswerAttemptDto[];
  progress: LearningProgressPointDto[];
}

export interface WrongAnswerListResponse {
  items: WrongAnswerItemDto[];
}

export type TodayNextActionType =
  | "confirm_scope"
  | "generate_map"
  | "start_diagnostic"
  | "review"
  | "continue_learning";

export interface TodayNextActionDto {
  type: TodayNextActionType;
  href: string;
  dueCount?: number;
  nextReviewAt?: string | null;
}

export interface LearningTodayGoalDto {
  goal: LearningGoalDto;
  project: { id: string; name: string };
  summary: LearningProgressSummaryDto;
  nextAction: TodayNextActionDto;
}

export interface LearningTodayResponse {
  asOf: string;
  goals: LearningTodayGoalDto[];
}
