import { cn } from "@/lib/utils";
import type {
  AttemptResultDto,
  EvaluationVerdict,
} from "@/lib/hooks/use-learning-api";
import { getEvaluationReasonLabel } from "@/components/learning/evaluation-copy";

export interface PracticeFeedbackProps {
  result: AttemptResultDto;
  className?: string;
}

const VERDICT_STYLES: Record<
  EvaluationVerdict,
  { label: string; dotClassName: string; textClassName: string }
> = {
  correct: {
    label: "回答正确",
    dotClassName: "bg-[var(--color-success)]",
    textClassName: "text-[var(--color-success)]",
  },
  partial: {
    label: "部分正确",
    dotClassName: "bg-[var(--color-warning)]",
    textClassName: "text-[var(--color-warning)]",
  },
  incorrect: {
    label: "回答错误",
    dotClassName: "bg-[var(--color-error)]",
    textClassName: "text-[var(--color-error)]",
  },
  uncertain: {
    label: "暂时无法判定，可以稍后重新作答",
    dotClassName: "bg-[var(--color-text-tertiary)]",
    textClassName: "text-[var(--color-text-secondary)]",
  },
};

/**
 * Post-submit feedback display. This is the only component allowed to render
 * `explanation`, which arrives inside `AttemptResultDto.feedback`.
 * Flat status dots and text hierarchy only — no bordered cards.
 */
export function PracticeFeedback({ result, className }: PracticeFeedbackProps) {
  const verdict = VERDICT_STYLES[result.evaluation.verdict];
  const explanation = result.feedback.explanation;
  const anchorCount = result.feedback.practiceItem.sourceAnchors.length;

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <p
        className={cn(
          "flex items-center gap-2 text-sm font-medium",
          verdict.textClassName
        )}
      >
        <span
          aria-hidden="true"
          className={cn("h-2 w-2 rounded-full", verdict.dotClassName)}
        />
        {verdict.label}
      </p>

      <p className="text-sm text-[var(--color-text-secondary)]">
        {getEvaluationReasonLabel(result.evaluation.reason)}
      </p>

      {explanation && (
        <section className="flex flex-col gap-1">
          <h4 className="text-sm font-medium text-[var(--color-text-primary)]">
            解析
          </h4>
          <p className="text-sm text-[var(--color-text-secondary)]">
            {explanation}
          </p>
        </section>
      )}

      {anchorCount > 0 && (
        <p className="text-xs text-[var(--color-text-tertiary)]">
          {`来源 ${anchorCount} 处`}
        </p>
      )}

      {result.attempt.assistanceLevel !== "independent" && (
        <p className="text-xs text-[var(--color-text-secondary)]">
          本次作答使用了辅助，对掌握度的影响会降低
        </p>
      )}

      {result.feedback.practiceItem.mode === "feedback_only" && (
        <p className="text-xs text-[var(--color-text-secondary)]">
          此反馈不影响掌握度
        </p>
      )}
    </div>
  );
}
