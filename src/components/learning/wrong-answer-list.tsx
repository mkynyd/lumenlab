import { cn } from "@/lib/utils";
import type {
  AssistanceLevel,
  EvaluationVerdict,
  WrongAnswerItemDto,
} from "@/lib/hooks/use-learning-api";
import { EmptyState } from "@/components/learning/empty-state";
import { getEvaluationReasonLabel } from "@/components/learning/evaluation-copy";

export interface WrongAnswerListProps {
  items: WrongAnswerItemDto[];
  className?: string;
}

const VERDICT_PRESENTATION: Record<
  EvaluationVerdict,
  { label: string; dotClassName: string }
> = {
  incorrect: { label: "回答错误", dotClassName: "bg-[var(--color-error)]" },
  partial: { label: "部分正确", dotClassName: "bg-[var(--color-warning)]" },
  uncertain: {
    label: "判定不确定",
    dotClassName: "bg-[var(--color-text-tertiary)]",
  },
  correct: {
    label: "回答正确",
    dotClassName: "bg-[var(--color-success)]",
  },
};

const VERDICT_HISTORY_LABELS: Record<EvaluationVerdict, string> = {
  correct: "回答正确",
  incorrect: "回答错误",
  partial: "部分正确",
  uncertain: "判定不确定",
};

const ERROR_TYPE_LABELS: Record<string, string> = {
  knowledge_gap: "知识空缺",
  misconception: "概念误解",
  method_choice: "方法选择",
  calculation_or_operation: "计算或操作失误",
  reading_or_time: "审题或时间",
  uncertain_evaluation: "判定不确定",
};

const ASSISTANCE_HINTS: Record<string, string> = {
  hinted: "最近一次作答使用了提示",
  answer_exposed: "最近一次作答前查看过解析",
};

const ASSISTANCE_HISTORY_LABELS: Record<AssistanceLevel, string> = {
  independent: "独立作答",
  hinted: "看过提示",
  answer_exposed: "看过答案",
};

function latestAttempt(item: WrongAnswerItemDto) {
  return item.attempts[item.attempts.length - 1];
}

function latestEvaluation(attempt: WrongAnswerItemDto["attempts"][number]) {
  return attempt.evaluations[attempt.evaluations.length - 1];
}

function AttemptHistory({ item }: { item: WrongAnswerItemDto }) {
  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-xs font-medium text-[var(--color-text-secondary)]">
        作答历史
      </summary>
      <ul className="mt-1 flex flex-col gap-1">
        {item.attempts.map((attempt) => {
          const evaluation = latestEvaluation(attempt);
          return (
            <li
              key={attempt.id}
              className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[var(--color-text-tertiary)]"
            >
              <span>
                {new Date(attempt.submittedAt).toLocaleDateString("zh-CN")}
              </span>
              <span>{ASSISTANCE_HISTORY_LABELS[attempt.assistanceLevel]}</span>
              {evaluation && (
                <span>{VERDICT_HISTORY_LABELS[evaluation.verdict]}</span>
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

function WrongAnswerItem({ item }: { item: WrongAnswerItemDto }) {
  const verdict = VERDICT_PRESENTATION[item.latestVerdict];
  const lastAttempt = latestAttempt(item);
  const lastEvaluation = lastAttempt ? latestEvaluation(lastAttempt) : undefined;
  const errorTypeLabel = lastEvaluation?.errorType
    ? (ERROR_TYPE_LABELS[lastEvaluation.errorType] ?? "其他原因")
    : null;
  const assistanceHint =
    lastAttempt && lastAttempt.assistanceLevel !== "independent"
      ? (ASSISTANCE_HINTS[lastAttempt.assistanceLevel] ?? null)
      : null;
  const knowledgePointNames = item.knowledgePoints.map((kp) => kp.name);

  return (
    <li className="flex flex-col gap-1.5 py-3">
      <p className="text-sm text-[var(--color-text-primary)]">
        {item.feedback.practiceItem.prompt}
      </p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-text-secondary)]">
        <span className="inline-flex items-center gap-1">
          <span
            aria-hidden="true"
            className={cn("h-1.5 w-1.5 rounded-full", verdict.dotClassName)}
          />
          {verdict.label}
        </span>
        {errorTypeLabel && <span>{errorTypeLabel}</span>}
        {lastEvaluation?.reason && (
          <span>{getEvaluationReasonLabel(lastEvaluation.reason)}</span>
        )}
        <span>作答 {item.attempts.length} 次</span>
        {assistanceHint && (
          <span className="text-[var(--color-text-tertiary)]">
            {assistanceHint}
          </span>
        )}
      </div>
      {knowledgePointNames.length > 0 && (
        <p className="text-xs text-[var(--color-text-tertiary)]">
          {knowledgePointNames.join(" · ")}
        </p>
      )}
      {item.feedback.explanation && (
        <details className="mt-1">
          <summary className="cursor-pointer text-xs font-medium text-[var(--color-text-secondary)]">
            解析
          </summary>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            {item.feedback.explanation}
          </p>
        </details>
      )}
      {item.attempts.length > 0 && <AttemptHistory item={item} />}
    </li>
  );
}

/**
 * Wrong-answer list: unresolved items are expanded in place; resolved ones
 * collapse into a keyboard-reachable native details section.
 */
export function WrongAnswerList({ items, className }: WrongAnswerListProps) {
  if (items.length === 0) {
    return <EmptyState className={className} title="还没有错题" />;
  }

  const unresolved = items.filter((item) => item.status === "unresolved");
  const resolved = items.filter((item) => item.status === "resolved");

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {unresolved.length > 0 && (
        <ul className="flex flex-col divide-y divide-[var(--color-border-light)]">
          {unresolved.map((item) => (
            <WrongAnswerItem key={item.itemLineageId} item={item} />
          ))}
        </ul>
      )}
      {resolved.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm font-medium text-[var(--color-text-secondary)]">
            已解决 {resolved.length}
          </summary>
          <ul className="mt-1 flex flex-col divide-y divide-[var(--color-border-light)]">
            {resolved.map((item) => (
              <WrongAnswerItem key={item.itemLineageId} item={item} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
