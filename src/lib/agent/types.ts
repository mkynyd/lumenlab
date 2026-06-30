/**
 * Agent 模式核心类型
 *
 * L0–L4 风险等级、Tool/Skill 元数据、审批/事件流统一在此声明。
 */

export type RiskLevel = "L0" | "L1" | "L2" | "L3" | "L4";

export type ApprovalMode = "auto" | "ask_first" | "ask_each" | "block";

export type ApprovalScope = "once" | "session";

export type AuditLevel = "minimal" | "standard" | "verbose";

export type ToolExecutionStatus =
  | "proposed"
  | "blocked"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "expired"
  | "executing"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface ToolMetadata {
  toolId: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  riskLevel: RiskLevel;
  isReadOnly: boolean;
  hasExternalSideEffect: boolean;
  isReversible: boolean;
  containsSensitiveData: boolean;
  requiresNetwork: boolean;
  estimatedCost?: string;
  defaultApprovalMode: ApprovalMode;
  allowedSkillIds: string[];
  auditLevel: AuditLevel;
  requiredScopes: string[];
}

export interface SkillMetadata {
  skillId: string;
  version: string;
  description: string;
  instructions: string;
  allowedTools: string[];
  allowedRiskLevel: RiskLevel[];
  requiredScopes: string[];
  defaultApprovalPolicy: ApprovalMode;
  inputContract: Record<string, unknown>;
  outputContract: Record<string, unknown>;
  dataHandlingPolicy: {
    maySendToExternal: boolean;
    mayPersist: boolean;
    retentionDays?: number;
  };
}

export interface AffectedResource {
  type: "file" | "project" | "artifact" | "url" | "email";
  identifier: string;
  displayName: string;
}

export interface ToolCallPreview {
  toolId: string;
  toolName: string;
  summary: string;
  affectedResources: AffectedResource[];
  sendsToExternal: boolean;
  externalTargets?: string[];
  isReversible: boolean;
  estimatedCost?: string;
  dataTypes: string[];
  batchCount?: number;
  samplePreview?: string;
  skillName?: string;
}

export interface WorkspacePolicy {
  toolId?: string;
  skillId?: string;
  mode: "block" | "restrict" | "audit_only";
  reason?: string;
}

export interface AgentContext {
  user: { id: string; scopes: string[] };
  workspace: { id: string; policies: WorkspacePolicy[] };
  conversation: {
    id: string;
    activeSkill?: { skillId: string; version: string };
    sessionApprovals: Map<string, ApprovalScope>;
  };
  skill?: SkillMetadata;
  tool: ToolMetadata;
  arguments: Record<string, unknown>;
  resourceContext: {
    projectId?: string;
    selectedFileIds?: string[];
  };
}

export interface PolicyDecision {
  decision: "allow" | "deny" | "require_approval";
  reasonCode: string;
  riskLevel: RiskLevel;
  approvalRequired: boolean;
  approvalScope?: ApprovalScope;
  sanitizedPreview: ToolCallPreview;
  allowedArgumentConstraints?: Record<string, unknown>;
  auditRequirements: AuditLevel;
  approvalToken?: {
    token: string;
    expiresAt: Date;
    executionId: string;
  };
}

export interface ApprovalTokenRecord {
  id: string;
  tokenHash: string;
  userId: string;
  conversationId: string;
  toolId: string;
  argumentsHash: string;
  requestId: string;
  createdAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
}

export interface ApprovalTokenPayload {
  tokenId: string;
  userId: string;
  conversationId: string;
  toolId: string;
  argumentsHash: string;
  requestId: string;
  expiresAt: number;
}

export interface ToolExecutionRecord {
  id: string;
  conversationId: string;
  userId: string;
  skillId: string | null;
  skillVersion: string | null;
  toolId: string;
  normalizedArguments: Record<string, unknown>;
  argumentsHash: string;
  riskLevel: RiskLevel;
  status: ToolExecutionStatus;
  approvalSnapshot: PolicyDecision | null;
  approvalTokenHash: string | null;
  approvalScope: ApprovalScope | null;
  createdAt: Date;
  expiresAt: Date | null;
  approvedAt: Date | null;
  executedAt: Date | null;
  completedAt: Date | null;
  resultSummary: Record<string, unknown> | null;
  errorSummary: { code: string; message: string } | null;
  auditMetadata: Record<string, unknown> | null;
}

import type { AgentSource } from "./sources";

export type AgentEvent =
  | {
      type: "skill_activated";
      skillId: string;
      version: string;
      status?: "active" | "awaiting_context";
      reason?: string;
    }
  | {
      type: "skill_suggested";
      suggestions: Array<{ skillId: string; label: string; reason: string }>;
    }
  | { type: "skill_deactivated"; skillId: string }
  | { type: "web_access_enabled"; mode: "auto" | "manual"; reason: string }
  | {
      type: "sources_updated";
      sources: AgentSource[];
    }
  | {
      type: "model_adapter_selected";
      provider: "deepseek" | "minimax";
      model: string;
      fallback: "native_tools" | "json_action" | "prefetch_tools" | "none";
    }
  | { type: "profile_changed"; from: string; to: string; reason: string }
  | { type: "tool_loop_stop_reason"; reason: string }
  | {
      type: "tool_proposed";
      executionId: string;
      preview: ToolCallPreview;
    }
  | {
      type: "tool_blocked";
      executionId: string;
      reasonCode: string;
      reason: string;
    }
  | {
      type: "approval_required";
      executionId: string;
      preview: ToolCallPreview;
      token: string;
      expiresAt: number;
    }
  | {
      type: "approval_granted";
      executionId: string;
      scope: ApprovalScope;
    }
  | { type: "approval_denied"; executionId: string; reason?: string }
  | { type: "approval_expired"; executionId: string }
  | { type: "tool_started"; executionId: string }
  | {
      type: "tool_progress";
      executionId: string;
      progress: number;
      message?: string;
    }
  | {
      type: "tool_completed";
      executionId: string;
      resultSummary: Record<string, unknown>;
    }
  | {
      type: "tool_failed";
      executionId: string;
      errorCode: string;
      error: string;
    }
  | {
      type: "context_budget_warning";
      tokens: number;
      budget: number;
      ratio: number;
    }
  | {
      type: "context_budget_compressed";
      tokens: number;
      budget: number;
      ratio: number;
      compressedCount: number;
    }
  | {
      type: "context_budget_overflow";
      tokens: number;
      budget: number;
      ratio: number;
    };
