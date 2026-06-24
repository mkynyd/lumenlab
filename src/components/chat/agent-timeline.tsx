"use client";

import { memo, useReducer } from "react";
import type {
  ApprovalScope,
  ToolCallPreview,
} from "@/lib/agent/types";
import { ToolCallCard } from "./tool-call-card";
import { ApprovalCard } from "./approval-card";

export type ApprovalState =
  | { kind: "idle" }
  | { kind: "proposed"; executionId: string; preview: ToolCallPreview }
  | {
      kind: "awaiting_user";
      executionId: string;
      preview: ToolCallPreview;
      token: string;
      expiresAt: number;
      canApproveSession: boolean;
    }
  | { kind: "approved"; executionId: string; scope: ApprovalScope }
  | { kind: "denied"; executionId: string; reason?: string }
  | {
      kind: "executing";
      executionId: string;
      progress?: number;
      message?: string;
    }
  | {
      kind: "completed";
      executionId: string;
      resultSummary?: Record<string, unknown>;
    }
  | { kind: "failed"; executionId: string; error: string };

export type ApprovalAction =
  | { type: "PROPOSE"; executionId: string; preview: ToolCallPreview }
  | {
      type: "REQUEST_APPROVAL";
      executionId: string;
      preview: ToolCallPreview;
      token: string;
      expiresAt: number;
      canApproveSession: boolean;
    }
  | { type: "APPROVE"; executionId: string; scope: ApprovalScope }
  | { type: "DENY"; executionId: string; reason?: string }
  | { type: "EXECUTE_START"; executionId: string }
  | {
      type: "EXECUTE_PROGRESS";
      executionId: string;
      progress: number;
      message?: string;
    }
  | {
      type: "EXECUTE_COMPLETE";
      executionId: string;
      resultSummary?: Record<string, unknown>;
    }
  | { type: "EXECUTE_FAIL"; executionId: string; error: string }
  | { type: "RESET" };

export function reduce(state: ApprovalState, action: ApprovalAction): ApprovalState {
  switch (action.type) {
    case "PROPOSE":
      return { kind: "proposed", executionId: action.executionId, preview: action.preview };
    case "REQUEST_APPROVAL":
      return {
        kind: "awaiting_user",
        executionId: action.executionId,
        preview: action.preview,
        token: action.token,
        expiresAt: action.expiresAt,
        canApproveSession: action.canApproveSession,
      };
    case "APPROVE":
      return { kind: "approved", executionId: action.executionId, scope: action.scope };
    case "DENY":
      return { kind: "denied", executionId: action.executionId, reason: action.reason };
    case "EXECUTE_START":
      return { kind: "executing", executionId: action.executionId };
    case "EXECUTE_PROGRESS":
      return {
        kind: "executing",
        executionId: action.executionId,
        progress: action.progress,
        message: action.message,
      };
    case "EXECUTE_COMPLETE":
      return {
        kind: "completed",
        executionId: action.executionId,
        resultSummary: action.resultSummary,
      };
    case "EXECUTE_FAIL":
      return { kind: "failed", executionId: action.executionId, error: action.error };
    case "RESET":
      return { kind: "idle" };
    default:
      return state;
  }
}

interface AgentTimelineProps {
  state: ApprovalState;
  onApprove?: (executionId: string, token: string, scope: ApprovalScope) => Promise<void> | void;
  onDeny?: (executionId: string, reason?: string) => Promise<void> | void;
}

function AgentTimelineComponent({ state, onApprove, onDeny }: AgentTimelineProps) {
  const [, dispatch] = useReducer(reduce, state);
  if (state.kind === "idle") return null;

  if (state.kind === "proposed" || state.kind === "executing" || state.kind === "completed" || state.kind === "failed") {
    return (
      <ToolCallCard
        preview={state.preview ?? fallbackPreview(state)}
        status={state.kind}
        progress={state.kind === "executing" ? state.progress : undefined}
        message={state.kind === "executing" ? state.message : undefined}
        resultSummary={state.kind === "completed" ? state.resultSummary : undefined}
        error={state.kind === "failed" ? state.error : undefined}
      />
    );
  }

  if (state.kind === "awaiting_user") {
    return (
      <ApprovalCard
        preview={state.preview}
        canApproveSession={state.canApproveSession}
        onApprove={async (scope) => {
          if (onApprove) await onApprove(state.executionId, state.token, scope);
          dispatch({ type: "APPROVE", executionId: state.executionId, scope });
        }}
        onDeny={async (reason) => {
          if (onDeny) await onDeny(state.executionId, reason);
          dispatch({ type: "DENY", executionId: state.executionId, reason });
        }}
      />
    );
  }

  if (state.kind === "approved" || state.kind === "denied") {
    return (
      <ToolCallCard
        preview={fallbackPreview(state)}
        status={state.kind === "approved" ? "completed" : "failed"}
        resultSummary={state.kind === "approved" ? { scope: state.scope } : undefined}
        error={state.kind === "denied" ? state.reason ?? "用户拒绝" : undefined}
      />
    );
  }

  return null;
}

function fallbackPreview(state: { executionId: string }): ToolCallPreview {
  return {
    toolId: state.executionId,
    toolName: "工具",
    summary: "工具调用",
    affectedResources: [],
    sendsToExternal: false,
    isReversible: true,
    dataTypes: [],
  };
}

export const AgentTimeline = memo(AgentTimelineComponent);
AgentTimeline.displayName = "AgentTimeline";