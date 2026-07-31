"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  LEARNING_ERROR_TYPES,
  type AssistanceLevel,
  type EvaluationVerdict,
  type LearningErrorType,
} from "@/lib/learning/contracts";
import {
  createIdempotencyKey,
  type LearningHistoryEvidenceDto,
  type LearningHistoryPointDto,
} from "@/lib/hooks/use-learning-api";
import {
  useCorrectLearningErrorType,
  useLearningHistory,
} from "@/lib/hooks/use-learning-history";
import { EmptyState } from "@/components/learning/empty-state";
import { getEvaluationReasonLabel } from "@/components/learning/evaluation-copy";
import { FreshnessBadge } from "@/components/learning/freshness-badge";
import { MasteryPill } from "@/components/learning/mastery-pill";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface LearningHistoryProps {
  projectId: string;
  goalId: string;
  className?: string;
}

const ERROR_TYPE_LABELS: Record<string, string> = {
  knowledge_gap: "知识空缺",
  misconception: "概念误解",
  method_choice: "方法选择",
  calculation_or_operation: "计算或操作失误",
  reading_or_time: "审题或时间",
  uncertain_evaluation: "判定不确定",
};

const VERDICT_LABELS: Record<EvaluationVerdict, string> = {
  correct: "回答正确",
  incorrect: "回答错误",
  partial: "部分正确",
  uncertain: "判定不确定",
};

const ASSISTANCE_LABELS: Record<AssistanceLevel, string> = {
  independent: "独立作答",
  hinted: "看过提示",
  answer_exposed: "已看答案",
};

const SESSION_MODE_LABELS: Record<"diagnostic" | "review", string> = {
  diagnostic: "诊断",
  review: "复习",
};

const REVIEW_STATE_LABELS: Record<"unscheduled" | "scheduled" | "due", string> =
  {
    unscheduled: "未安排复习",
    scheduled: "已安排复习",
    due: "待复习",
  };

function errorTypeLabel(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  return ERROR_TYPE_LABELS[value] ?? "其他原因";
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleDateString("zh-CN");
}

type SourceAnchorShape = {
  id: string;
  sourceFileName: string;
  locator: Record<string, unknown>;
};

/** Human-readable page / paragraph / block position; null when unknown. */
export function formatSourceLocator(
  locator: Record<string, unknown>
): string | null {
  const page = locator.page;
  if (typeof page === "number" && Number.isFinite(page)) {
    return `第 ${page} 页`;
  }
  const paragraph = locator.paragraph;
  if (typeof paragraph === "number" && Number.isFinite(paragraph)) {
    return `第 ${paragraph} 段`;
  }
  const block = locator.block;
  if (typeof block === "number" && Number.isFinite(block)) {
    return `第 ${block} 块`;
  }
  if (typeof block === "string" && block.trim().length > 0) {
    return `块 ${block.trim()}`;
  }
  return null;
}

function SourceAnchorText({ anchors }: { anchors: SourceAnchorShape[] }) {
  if (anchors.length === 0) {
    return null;
  }
  const text = anchors
    .map((anchor) => {
      const locatorLabel = formatSourceLocator(anchor.locator);
      return locatorLabel
        ? `${anchor.sourceFileName} · ${locatorLabel}`
        : anchor.sourceFileName;
    })
    .join("；");
  return (
    <p className="text-xs break-words text-[var(--color-text-tertiary)]">
      来源：{text}
    </p>
  );
}

interface ErrorTypeCorrectionEditorProps {
  projectId: string;
  goalId: string;
  evaluationId: string;
}

/**
 * Manual error-type correction on the active evaluation. The idempotency key
 * is stable across retries of the same save action and rotates on success.
 */
function ErrorTypeCorrectionEditor({
  projectId,
  goalId,
  evaluationId,
}: ErrorTypeCorrectionEditorProps) {
  const correction = useCorrectLearningErrorType(projectId, goalId);
  const [selected, setSelected] = useState<LearningErrorType | null>(null);
  const [saved, setSaved] = useState(false);
  const idempotencyKeyRef = useRef<string | null>(null);

  const save = () => {
    if (!selected || correction.isPending) {
      return;
    }
    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = createIdempotencyKey();
    }
    setSaved(false);
    correction.mutate(
      {
        evaluationId,
        errorType: selected,
        idempotencyKey: idempotencyKeyRef.current,
      },
      {
        onSuccess: () => {
          idempotencyKeyRef.current = null;
          setSaved(true);
        },
      }
    );
  };

  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={selected ?? ""}
          onValueChange={(value) => {
            if (selected !== value) {
              idempotencyKeyRef.current = null;
            }
            setSelected(value as LearningErrorType);
            setSaved(false);
          }}
          disabled={correction.isPending}
        >
          <SelectTrigger
            aria-label="错因类型"
            size="sm"
            className="min-w-32"
          >
            <SelectValue placeholder="选择错因" />
          </SelectTrigger>
          <SelectContent>
            {LEARNING_ERROR_TYPES.map((errorType) => (
              <SelectItem key={errorType} value={errorType}>
                {ERROR_TYPE_LABELS[errorType]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={save}
          disabled={!selected || correction.isPending}
        >
          {correction.isPending ? "保存中…" : "保存修正"}
        </Button>
      </div>
      <div aria-live="polite">
        {correction.isPending && (
          <p role="status" className="text-xs text-[var(--color-text-secondary)]">
            正在保存修正…
          </p>
        )}
        {correction.isError && (
          <p role="alert" className="text-xs text-[var(--color-error)]">
            保存修正失败，请重试。
          </p>
        )}
        {saved && !correction.isPending && !correction.isError && (
          <p role="status" className="text-xs text-[var(--color-text-secondary)]">
            已保存修正。
          </p>
        )}
      </div>
    </div>
  );
}

interface EvidenceItemProps {
  evidence: LearningHistoryEvidenceDto;
  projectId: string;
  goalId: string;
}

function EvidenceItem({ evidence, projectId, goalId }: EvidenceItemProps) {
  const activeEvaluation = evidence.activeEvaluationId
    ? evidence.evaluations.find(
        (evaluation) => evaluation.id === evidence.activeEvaluationId
      )
    : undefined;
  const effective = evidence.effectiveErrorType;
  const effectiveLabel = effective ? errorTypeLabel(effective.value) : null;
  const originalLabel = activeEvaluation
    ? errorTypeLabel(activeEvaluation.errorType)
    : null;
  const latestCorrection = activeEvaluation?.corrections.length
    ? activeEvaluation.corrections[activeEvaluation.corrections.length - 1]
    : null;

  return (
    <li className="min-w-0">
      <details>
        <summary className="cursor-pointer text-xs font-medium text-[var(--color-text-secondary)]">
          {formatDate(evidence.attempt.submittedAt)} ·{" "}
          {SESSION_MODE_LABELS[evidence.session.mode]} ·{" "}
          {activeEvaluation
            ? VERDICT_LABELS[activeEvaluation.verdict]
            : "暂无有效判定"}
        </summary>
        <div className="mt-1.5 flex min-w-0 flex-col gap-1.5">
          <p className="text-sm break-words text-[var(--color-text-primary)]">
            {evidence.practiceItem.prompt}
          </p>
          <ul className="flex flex-col gap-1 text-xs text-[var(--color-text-secondary)]">
            <li>
              作答方式：{ASSISTANCE_LABELS[evidence.attempt.assistanceLevel]}
            </li>
            {activeEvaluation ? (
              <>
                <li>有效判定：{VERDICT_LABELS[activeEvaluation.verdict]}</li>
                <li>
                  判定理由：{getEvaluationReasonLabel(activeEvaluation.reason)}
                </li>
              </>
            ) : (
              <li>判定链暂不可用，本次作答不会影响当前档案。</li>
            )}
            {effectiveLabel && (
              <li className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span>有效错因：{effectiveLabel}</span>
                {effective?.source === "user_correction" && (
                  <span className="rounded-full bg-[var(--color-accent-muted)] px-2 py-0.5 text-[var(--color-accent)]">
                    人工修正
                  </span>
                )}
              </li>
            )}
            {effective?.source === "user_correction" && originalLabel && (
              <li>原判定错因：{originalLabel}（原判定记录仍保留）</li>
            )}
            {effective?.source === "user_correction" &&
              latestCorrection?.reason && (
                <li>修正说明：{latestCorrection.reason}</li>
              )}
          </ul>
          <SourceAnchorText anchors={evidence.practiceItem.sourceAnchors} />
          {activeEvaluation && (
            <ErrorTypeCorrectionEditor
              projectId={projectId}
              goalId={goalId}
              evaluationId={activeEvaluation.id}
            />
          )}
        </div>
      </details>
    </li>
  );
}

interface HistoryPointProps {
  point: LearningHistoryPointDto;
  projectId: string;
  goalId: string;
}

function HistoryPoint({ point, projectId, goalId }: HistoryPointProps) {
  return (
    <li className="flex min-w-0 flex-col gap-1.5 py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-sm font-medium text-[var(--color-text-primary)]">
          {point.name}
        </span>
        <MasteryPill state={point.masteryState} />
        <FreshnessBadge freshness={point.freshness} />
        <span className="text-xs text-[var(--color-text-secondary)]">
          {REVIEW_STATE_LABELS[point.reviewState]}
          {point.reviewState === "scheduled" && point.nextReviewAt
            ? ` · ${formatDate(point.nextReviewAt)}`
            : ""}
        </span>
      </div>
      <SourceAnchorText anchors={point.sourceAnchors} />
      {point.evidence.length === 0 ? (
        <p className="text-xs text-[var(--color-text-tertiary)]">
          暂无作答证据，完成诊断或复习后会记录在这里。
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {point.evidence.map((evidence) => (
            <EvidenceItem
              key={evidence.attempt.id}
              evidence={evidence}
              projectId={projectId}
              goalId={goalId}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * Explainable learning profile: per-point mastery / review / freshness state
 * with expandable evidence and manual error-type corrections. All internal
 * codes are mapped to Chinese labels; answer criteria and generation metadata
 * never cross this boundary.
 */
export function LearningHistory({
  projectId,
  goalId,
  className,
}: LearningHistoryProps) {
  const {
    data: history,
    isPending,
    isError,
    refetch,
  } = useLearningHistory(projectId, goalId);

  if (isPending) {
    return (
      <div
        role="status"
        className={cn(
          "px-1 py-8 text-sm text-[var(--color-text-secondary)]",
          className
        )}
      >
        加载中…
      </div>
    );
  }

  if (isError) {
    return (
      <EmptyState
        className={className}
        title="学习档案加载失败"
        description="请稍后重试。"
        action={
          <Button type="button" variant="ghost" onClick={() => refetch()}>
            重试
          </Button>
        }
      />
    );
  }

  if (!history || history.points.length === 0) {
    return (
      <EmptyState
        className={className}
        title="还没有学习档案"
        description="完成一次诊断或复习后，这里会记录每个知识点的掌握情况与作答证据。"
      />
    );
  }

  const { summary } = history;

  return (
    <div className={cn("flex w-full min-w-0 flex-col gap-3", className)}>
      <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
        {history.goal.title}
      </h2>
      <p className="text-xs text-[var(--color-text-secondary)]">
        知识点 {summary.totalPoints} · 薄弱点 {summary.weakPoints} · 到期复习{" "}
        {summary.dueReviews} · 作答 {summary.attempts} 次 · 人工修正{" "}
        {summary.manualCorrections} 次
      </p>
      <ul className="flex flex-col divide-y divide-[var(--color-border-light)]">
        {history.points.map((point) => (
          <HistoryPoint
            key={point.lineageId}
            point={point}
            projectId={projectId}
            goalId={goalId}
          />
        ))}
      </ul>
    </div>
  );
}
