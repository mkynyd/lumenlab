import type { TaskProfile } from "./skill-router";

export type AgentPlanStepStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "blocked"
  | "skipped";

export interface AgentPlanStep {
  id: string;
  title: string;
  status: AgentPlanStepStatus;
  reason?: string;
}

export interface AgentPlan {
  title: string;
  status: "in_progress" | "blocked" | "completed";
  currentStepId: string;
  steps: AgentPlanStep[];
}

export interface PlanUpdate {
  steps: AgentPlanStep[];
  currentStepId: string;
}

const PLAN_PROFILES = new Set<TaskProfile>(["research", "workflow"]);
const STEP_STATUSES = new Set<AgentPlanStepStatus>([
  "pending",
  "in_progress",
  "completed",
  "blocked",
  "skipped",
]);
const STEP_ID = /^[a-z][a-z0-9_-]{0,39}$/;
const PUBLIC_STEP_TITLES: Record<string, readonly string[]> = {
  understand: ["明确研究问题与边界", "明确交付目标与约束"],
  gather: ["收集可核验的资料"],
  compare: ["比较证据并形成结论"],
  verify: ["核验引用与不确定性", "检查结果与下一步"],
  prepare: ["准备所需资料与操作"],
  execute: ["执行并记录关键结果"],
};

/**
 * Build a deterministic public plan. It never exposes hidden prompts or model
 * reasoning, and simple/RAG turns deliberately keep their lightweight flow.
 */
export function buildInitialAgentPlan(input: {
  profile: TaskProfile;
  prompt: string;
}): AgentPlan | null {
  if (!PLAN_PROFILES.has(input.profile)) return null;

  const steps: AgentPlanStep[] =
    input.profile === "research"
      ? [
          { id: "understand", title: "明确研究问题与边界", status: "in_progress" },
          { id: "gather", title: "收集可核验的资料", status: "pending" },
          { id: "compare", title: "比较证据并形成结论", status: "pending" },
          { id: "verify", title: "核验引用与不确定性", status: "pending" },
        ]
      : [
          { id: "understand", title: "明确交付目标与约束", status: "in_progress" },
          { id: "prepare", title: "准备所需资料与操作", status: "pending" },
          { id: "execute", title: "执行并记录关键结果", status: "pending" },
          { id: "verify", title: "检查结果与下一步", status: "pending" },
        ];

  return {
    title: input.profile === "research" ? "研究计划" : "任务计划",
    status: "in_progress",
    currentStepId: "understand",
    steps,
  };
}

/**
 * Validates the only model-writable planning shape before it can reach the
 * event stream. This makes plan.update a constrained state update, not a
 * scratchpad for hidden reasoning or arbitrary text.
 */
export function parsePlanUpdate(value: unknown): PlanUpdate {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidPlanUpdate();
  }
  const input = value as Record<string, unknown>;
  if (
    !Array.isArray(input.steps) ||
    input.steps.length < 1 ||
    input.steps.length > 6 ||
    typeof input.currentStepId !== "string" ||
    !STEP_ID.test(input.currentStepId)
  ) {
    throw invalidPlanUpdate();
  }

  const ids = new Set<string>();
  const steps = input.steps.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw invalidPlanUpdate();
    }
    const step = raw as Record<string, unknown>;
    if (
      typeof step.id !== "string" ||
      !STEP_ID.test(step.id) ||
      ids.has(step.id) ||
      typeof step.title !== "string" ||
      !PUBLIC_STEP_TITLES[step.id]?.includes(step.title) ||
      typeof step.status !== "string" ||
      !STEP_STATUSES.has(step.status as AgentPlanStepStatus) ||
      step.reason !== undefined
    ) {
      throw invalidPlanUpdate();
    }
    ids.add(step.id);
    return {
      id: step.id,
      title: step.title,
      status: step.status as AgentPlanStepStatus,
    };
  });

  if (!ids.has(input.currentStepId)) throw invalidPlanUpdate();
  return { steps, currentStepId: input.currentStepId };
}

export function materializePlanUpdate(
  update: PlanUpdate,
  title = "任务计划"
): AgentPlan {
  const current = update.steps.find((step) => step.id === update.currentStepId);
  const status = current?.status === "blocked"
    ? "blocked"
    : update.steps.every((step) => step.status === "completed")
      ? "completed"
      : "in_progress";
  return { title, status, currentStepId: update.currentStepId, steps: update.steps };
}

/** Marks the public plan at the Runtime terminal boundary without fabricating hidden work. */
export function finalizeAgentPlan(
  plan: AgentPlan,
  status: "completed" | "awaiting_approval" | "cancelled"
): AgentPlan {
  const currentStatus: AgentPlanStepStatus =
    status === "completed" ? "completed" : "blocked";
  const reason =
    status === "awaiting_approval"
      ? "等待你的确认后继续。"
      : status === "cancelled"
        ? "本次请求已取消。"
        : undefined;
  return {
    ...plan,
    status: status === "completed" ? "completed" : "blocked",
    steps: plan.steps.map((step) =>
      step.id === plan.currentStepId
        ? { ...step, status: currentStatus, ...(reason ? { reason } : {}) }
        : status === "completed" && step.status !== "completed"
          ? {
              ...step,
              status: "skipped",
              reason: "本次直接完成答复，未单独执行该步骤。",
            }
          : step
    ),
  };
}

function invalidPlanUpdate() {
  return new Error("计划更新格式无效");
}
