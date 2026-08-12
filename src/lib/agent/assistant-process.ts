import type { AgentPlan } from "./plan";
import type { AgentSource } from "./sources";
import type { AgentEvent, ToolCallPreview } from "./types";

export type AssistantProcessToolStatus =
  | "proposed"
  | "awaiting_approval"
  | "executing"
  | "completed"
  | "failed";

export interface AssistantProcessTool {
  executionId: string;
  toolId: string;
  label: string;
  status: AssistantProcessToolStatus;
  progress?: number;
  message?: string;
  error?: string;
  sources: AgentSource[];
  preview?: ToolCallPreview;
  approval?: {
    token?: string;
    expiresAt: number;
    canApproveSession: boolean;
  };
}

export interface AssistantProcessTrace {
  status: "running" | "completed" | "failed" | "cancelled";
  startedAt?: number;
  completedAt?: number;
  plan?: AgentPlan;
  tools: AssistantProcessTool[];
}

export function createAssistantProcessTrace(startedAt = Date.now()): AssistantProcessTrace {
  return { status: "running", startedAt, tools: [] };
}

function fallbackTool(executionId: string): AssistantProcessTool {
  return {
    executionId,
    toolId: executionId,
    label: "正在使用工具",
    status: "proposed",
    sources: [],
  };
}

function updateTool(
  trace: AssistantProcessTrace,
  executionId: string,
  update: (tool: AssistantProcessTool) => AssistantProcessTool
): AssistantProcessTrace {
  const index = trace.tools.findIndex((tool) => tool.executionId === executionId);
  const current = index >= 0 ? trace.tools[index] : fallbackTool(executionId);
  const nextTools = [...trace.tools];
  if (index >= 0) nextTools[index] = update(current);
  else nextTools.push(update(current));
  return { ...trace, tools: nextTools };
}

export function reduceAssistantProcess(
  trace: AssistantProcessTrace,
  event: AgentEvent
): AssistantProcessTrace {
  if (event.type === "plan_updated") {
    return { ...trace, plan: event.plan };
  }
  if (event.type === "tool_proposed") {
    return updateTool(trace, event.executionId, (tool) => ({
      ...tool,
      toolId: event.preview.toolId,
      label: event.preview.summary,
      preview: event.preview,
      status: "proposed",
    }));
  }
  if (event.type === "approval_required") {
    return updateTool(trace, event.executionId, (tool) => ({
      ...tool,
      toolId: event.preview.toolId,
      label: event.preview.summary,
      preview: event.preview,
      status: "awaiting_approval",
      approval: {
        token: event.token || undefined,
        expiresAt: event.expiresAt,
        canApproveSession: event.canApproveSession,
      },
    }));
  }
  if (event.type === "tool_started") {
    return updateTool(trace, event.executionId, (tool) => ({
      ...tool,
      status: "executing",
    }));
  }
  if (event.type === "tool_progress") {
    return updateTool(trace, event.executionId, (tool) => ({
      ...tool,
      status: "executing",
      progress: event.progress,
      message: event.message,
    }));
  }
  if (event.type === "tool_source_discovered") {
    return updateTool(trace, event.executionId, (tool) => {
      const exists = tool.sources.some((source) =>
        source.url && event.source.url
          ? source.url === event.source.url
          : source.title === event.source.title
      );
      return {
        ...tool,
        status: "executing",
        sources: exists ? tool.sources : [...tool.sources, event.source],
      };
    });
  }
  if (event.type === "tool_completed") {
    return updateTool(trace, event.executionId, (tool) => ({
      ...tool,
      status: "completed",
      progress: 100,
    }));
  }
  if (event.type === "tool_failed" || event.type === "tool_blocked") {
    return updateTool(trace, event.executionId, (tool) => ({
      ...tool,
      status: "failed",
      error: event.type === "tool_failed" ? event.error : event.reason,
    }));
  }
  if (event.type === "approval_denied" || event.type === "approval_expired") {
    return updateTool(trace, event.executionId, (tool) => ({
      ...tool,
      status: "failed",
      error:
        event.type === "approval_expired"
          ? "审批已过期"
          : event.reason ?? "用户拒绝",
    }));
  }
  if (event.type === "approval_granted") {
    return updateTool(trace, event.executionId, (tool) => ({
      ...tool,
      status: "executing",
    }));
  }
  return trace;
}

export function completeAssistantProcess(
  trace: AssistantProcessTrace,
  status: AssistantProcessTrace["status"] = "completed",
  completedAt = Date.now()
): AssistantProcessTrace {
  return { ...trace, status, completedAt };
}

interface PersistedProcessEvent {
  type: string;
  payload: unknown;
  createdAt?: Date | string;
}

function eventTime(value: Date | string | undefined) {
  if (!value) return undefined;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : undefined;
}

function operationalEvent(value: unknown): AgentEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const eventJson = (value as Record<string, unknown>).eventJson;
  if (typeof eventJson !== "string") return null;
  try {
    const parsed = JSON.parse(eventJson) as AgentEvent;
    return parsed && typeof parsed === "object" && "type" in parsed
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function hydrateAssistantProcess(
  events: PersistedProcessEvent[]
): AssistantProcessTrace | undefined {
  if (events.length === 0) return undefined;
  const startedAt = eventTime(events[0]?.createdAt);
  let trace = createAssistantProcessTrace(startedAt);
  let hasPublicProcess = false;

  for (const stored of events) {
    const occurredAt = eventTime(stored.createdAt) ?? Date.now();
    const event = stored.type === "agent_event"
      ? operationalEvent(stored.payload)
      : null;
    if (event) {
      const next = reduceAssistantProcess(trace, event);
      hasPublicProcess ||= next !== trace;
      trace = next;
      continue;
    }
    if (stored.type === "run_completed") {
      trace = completeAssistantProcess(trace, "completed", occurredAt);
    } else if (stored.type === "run_failed") {
      trace = completeAssistantProcess(trace, "failed", occurredAt);
    } else if (stored.type === "run_cancelled") {
      trace = completeAssistantProcess(trace, "cancelled", occurredAt);
    }
  }

  return hasPublicProcess ? trace : undefined;
}
