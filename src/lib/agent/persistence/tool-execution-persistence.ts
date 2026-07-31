import type {
  PolicyDecision,
  RiskLevel,
  ToolExecutionStatus,
  ToolMetadata,
} from "../types";

export interface ToolProposal {
  userId: string;
  conversationId: string;
  skillId?: string;
  skillVersion?: string;
  tool: ToolMetadata;
  arguments: Record<string, unknown>;
  riskLevel: RiskLevel;
  contextSnapshot: {
    projectId?: string;
    selectedFileIds?: string[];
    runId?: string;
  };
  agentExecutionId?: string;
  providerToolCallId?: string;
}

export interface PersistedToolProposal {
  id: string;
  status?: ToolExecutionStatus;
  resultSummary?: Record<string, unknown> | null;
  errorSummary?: { code: string; message: string } | null;
}

export interface ToolExecutionPersistence {
  loadSessionApprovals(input: {
    userId: string;
    conversationId: string;
  }): Promise<Map<string, "session">>;
  propose(input: ToolProposal): Promise<PersistedToolProposal>;
  markBlocked(
    executionId: string,
    error: { code: string; message: string }
  ): Promise<void>;
  claimPendingAsBlocked(
    executionId: string,
    error: { code: string; message: string }
  ): Promise<boolean>;
  markPendingApproval(
    executionId: string,
    input: { expiresAt: Date; approvalSnapshot: PolicyDecision }
  ): Promise<void>;
  claimApprovedExecution(
    executionId: string,
    input: { scope: "once" | "session" }
  ): Promise<boolean>;
  markExecuting(executionId: string): Promise<void>;
  markSucceeded(
    executionId: string,
    result: Record<string, unknown>
  ): Promise<void>;
  markFailed(
    executionId: string,
    error: { code: string; message: string }
  ): Promise<void>;
}
