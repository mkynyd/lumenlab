import type { AgentPlan } from "@/lib/agent/plan";
import { cn } from "@/lib/utils";

interface AgentRunStatusProps {
  plan?: AgentPlan;
  needsUserDecision?: boolean;
}

const STEP_STATUS_LABEL: Record<AgentPlan["steps"][number]["status"], string> = {
  pending: "待进行",
  in_progress: "进行中",
  completed: "已完成",
  blocked: "已阻塞",
  skipped: "已跳过",
};

const STEP_STATUS_STYLE: Record<AgentPlan["steps"][number]["status"], string> = {
  pending: "bg-[var(--color-panel)] text-[var(--color-text-tertiary)]",
  in_progress: "bg-[var(--color-primary)]/12 text-[var(--color-primary)]",
  completed: "bg-[var(--color-success)]/12 text-[var(--color-success)]",
  blocked: "bg-[var(--color-warning)]/12 text-[var(--color-warning)]",
  skipped: "bg-[var(--color-panel)] text-[var(--color-text-tertiary)]",
};

/**
 * A compact, streaming-safe view of public agent state. It intentionally
 * renders only plans and an approval hand-off; tool usage is summarized
 * inline at the end of each assistant message instead.
 */
export function AgentRunStatus({
  plan,
  needsUserDecision = false,
}: AgentRunStatusProps) {
  if (!plan && !needsUserDecision) return null;

  return (
    <section
      aria-label="任务运行状态"
      className="mx-4 mt-2 rounded-[var(--radius-lg)] bg-[var(--color-panel-muted)] px-3 py-2.5"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-[var(--color-text-primary)]">
          {plan?.title ?? "任务状态"}
        </p>
        {needsUserDecision ? (
          <span className="rounded-[var(--radius-sm)] bg-[var(--color-warning)]/12 px-2 py-0.5 text-xs text-[var(--color-warning)]">
            等待你的决定
          </span>
        ) : plan ? (
          <span className="text-xs text-[var(--color-text-tertiary)]">
            当前：{STEP_STATUS_LABEL[plan.steps.find((step) => step.id === plan.currentStepId)?.status ?? "pending"]}
          </span>
        ) : null}
      </div>

      {plan && (
        <ol className="mt-2 space-y-1.5">
          {plan.steps.map((step) => {
            const current = step.id === plan.currentStepId;
            return (
              <li key={step.id} className="flex items-center gap-2 text-xs">
                <span
                  className={cn(
                    "inline-flex min-w-12 justify-center rounded-[var(--radius-sm)] px-1.5 py-0.5",
                    STEP_STATUS_STYLE[step.status]
                  )}
                >
                  {STEP_STATUS_LABEL[step.status]}
                </span>
                <span
                  className={cn(
                    "min-w-0 flex-1 text-[var(--color-text-secondary)]",
                    current && "font-medium text-[var(--color-text-primary)]"
                  )}
                >
                  {step.title}
                </span>
                {step.reason && (
                  <span className="truncate text-[var(--color-text-tertiary)]">
                    {step.reason}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {needsUserDecision && (
        <p className="mt-2 text-xs leading-5 text-[var(--color-warning)]">
          请在下方确认或拒绝待执行操作；确认前不会执行。
        </p>
      )}
    </section>
  );
}
