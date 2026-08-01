"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  EVALUATION_VERDICTS,
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
  useRegradeEvaluation,
  useResetLearningProfile,
  useReviseGoal,
} from "@/lib/hooks/use-learning-history";
import { EmptyState } from "@/components/learning/empty-state";
import { getEvaluationReasonLabel } from "@/components/learning/evaluation-copy";
import { FreshnessBadge } from "@/components/learning/freshness-badge";
import { MasteryPill } from "@/components/learning/mastery-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

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
  // Locator v2 discriminated formats (P1-C): block / page / range.
  if (locator.kind === "block") {
    const parts: string[] = [];
    const pageNumber = locator.pageNumber;
    if (typeof pageNumber === "number" && Number.isFinite(pageNumber)) {
      parts.push(`第 ${pageNumber} 页`);
    }
    const blockId = locator.blockId;
    if (typeof blockId === "string" && blockId.trim().length > 0) {
      parts.push(`块 ${blockId.trim()}`);
    }
    return parts.length > 0 ? parts.join(" · ") : null;
  }
  if (locator.kind === "page") {
    const parts: string[] = [];
    const page = locator.page;
    if (typeof page === "number" && Number.isFinite(page)) {
      parts.push(`第 ${page} 页`);
    }
    const paragraph = locator.paragraph;
    if (typeof paragraph === "number" && Number.isFinite(paragraph)) {
      parts.push(`第 ${paragraph} 段`);
    }
    return parts.length > 0 ? parts.join(" · ") : null;
  }
  if (locator.kind === "range") {
    const page = locator.page;
    if (typeof page === "number" && Number.isFinite(page)) {
      return `第 ${page} 页 · ${String(locator.start)}-${String(locator.end)}`;
    }
    return `${String(locator.start)}-${String(locator.end)}`;
  }
  // Legacy flat formats.
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

interface RegradeEditorProps {
  projectId: string;
  goalId: string;
  evaluationId: string;
}

/**
 * Manual verdict correction on the active evaluation. Appends a superseding
 * evaluation through the regrade API; the original evaluation stays visible
 * in the chain. The idempotency key is stable across retries of the same
 * action and rotates on success.
 */
function RegradeEditor({
  projectId,
  goalId,
  evaluationId,
}: RegradeEditorProps) {
  const regrade = useRegradeEvaluation(projectId, goalId);
  const [verdict, setVerdict] = useState<EvaluationVerdict | null>(null);
  const [errorType, setErrorType] = useState<LearningErrorType | null>(null);
  const [reason, setReason] = useState("");
  const [saved, setSaved] = useState(false);
  const idempotencyKeyRef = useRef<string | null>(null);

  const canSave = verdict !== null && reason.trim().length > 0;

  const save = () => {
    if (!canSave || regrade.isPending) {
      return;
    }
    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = createIdempotencyKey();
    }
    setSaved(false);
    regrade.mutate(
      {
        evaluationId,
        verdict,
        ...(errorType === null ? {} : { errorType }),
        reason: reason.trim(),
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
          value={verdict ?? ""}
          onValueChange={(value) => {
            if (verdict !== value) {
              idempotencyKeyRef.current = null;
            }
            setVerdict(value as EvaluationVerdict);
            setSaved(false);
          }}
          disabled={regrade.isPending}
        >
          <SelectTrigger aria-label="纠正后的判定" size="sm" className="min-w-32">
            <SelectValue placeholder="纠正为" />
          </SelectTrigger>
          <SelectContent>
            {EVALUATION_VERDICTS.map((verdictOption) => (
              <SelectItem key={verdictOption} value={verdictOption}>
                {VERDICT_LABELS[verdictOption]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={errorType ?? ""}
          onValueChange={(value) => {
            if (errorType !== value) {
              idempotencyKeyRef.current = null;
            }
            setErrorType(value as LearningErrorType);
            setSaved(false);
          }}
          disabled={regrade.isPending}
        >
          <SelectTrigger aria-label="纠正错因" size="sm" className="min-w-32">
            <SelectValue placeholder="错因（可选）" />
          </SelectTrigger>
          <SelectContent>
            {LEARNING_ERROR_TYPES.map((errorTypeOption) => (
              <SelectItem key={errorTypeOption} value={errorTypeOption}>
                {ERROR_TYPE_LABELS[errorTypeOption]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Textarea
        aria-label="纠正说明"
        value={reason}
        onChange={(event) => {
          if (reason !== event.target.value) {
            idempotencyKeyRef.current = null;
          }
          setReason(event.target.value);
          setSaved(false);
        }}
        placeholder="说明为什么纠正这个判定（必填）"
        disabled={regrade.isPending}
        className="min-h-16 text-sm"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={save}
          disabled={!canSave || regrade.isPending}
        >
          {regrade.isPending ? "保存中…" : "保存纠正"}
        </Button>
        <div aria-live="polite">
          {regrade.isError && (
            <p role="alert" className="text-xs text-[var(--color-error)]">
              保存纠正失败，请重试。
            </p>
          )}
          {saved && !regrade.isPending && !regrade.isError && (
            <p role="status" className="text-xs text-[var(--color-text-secondary)]">
              已保存纠正，掌握度与复习安排已更新。
            </p>
          )}
        </div>
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
  const [regradeOpen, setRegradeOpen] = useState(false);

  return (
    <li className="min-w-0">
      <details>
        <summary className="cursor-pointer text-xs font-medium text-[var(--color-text-secondary)]">
          {evidence.resetBefore && (
            <span className="mr-1.5 rounded-full bg-[var(--color-accent-muted)] px-2 py-0.5 text-[var(--color-accent)]">
              重置前记录
            </span>
          )}
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
            {evidence.resetBefore && (
              <li>该记录位于画像重置边界之前，不再影响当前掌握度与推荐。</li>
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
          {activeEvaluation && !evidence.resetBefore && (
            <>
              <ErrorTypeCorrectionEditor
                projectId={projectId}
                goalId={goalId}
                evaluationId={activeEvaluation.id}
              />
              <div className="flex flex-col gap-1.5">
                <button
                  type="button"
                  className="self-start text-xs font-medium text-[var(--color-accent)]"
                  onClick={() => setRegradeOpen((open) => !open)}
                >
                  {regradeOpen ? "收起纠正判定" : "纠正判定"}
                </button>
                {regradeOpen && (
                  <RegradeEditor
                    projectId={projectId}
                    goalId={goalId}
                    evaluationId={activeEvaluation.id}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </details>
    </li>
  );
}

interface PointResetButtonProps {
  projectId: string;
  goalId: string;
  lineageId: string;
}

function PointResetButton({
  projectId,
  goalId,
  lineageId,
}: PointResetButtonProps) {
  const reset = useResetLearningProfile(projectId, goalId);
  const [confirmed, setConfirmed] = useState(false);

  const perform = () => {
    if (!confirmed) {
      setConfirmed(true);
      return;
    }
    setConfirmed(false);
    reset.mutate({ scope: { kind: "point", goalId, lineageId } });
  };

  return (
    <button
      type="button"
      onClick={perform}
      disabled={reset.isPending}
      className="text-xs font-medium text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
    >
      {confirmed ? "再次点击确认重置该知识点" : "重置该知识点"}
    </button>
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
        {point.resetAt && (
          <span className="rounded-full bg-[var(--color-accent-muted)] px-2 py-0.5 text-[var(--color-accent)]">
            画像已重置 · {formatDate(point.resetAt)}
          </span>
        )}
        <PointResetButton
          projectId={projectId}
          goalId={goalId}
          lineageId={point.lineageId}
        />
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

interface GoalRevisionEditorProps {
  projectId: string;
  goalId: string;
  goalTitle: string;
}

function GoalRevisionEditor({
  projectId,
  goalId,
  goalTitle,
}: GoalRevisionEditorProps) {
  const revise = useReviseGoal(projectId, goalId);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(goalTitle);
  const [purpose, setPurpose] = useState("");
  const [dailyMinutes, setDailyMinutes] = useState("");
  const [reason, setReason] = useState("");
  const [saved, setSaved] = useState(false);
  const idempotencyKeyRef = useRef<string | null>(null);

  const canSave = reason.trim().length > 0;

  const save = () => {
    if (!canSave || revise.isPending) {
      return;
    }
    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = createIdempotencyKey();
    }
    setSaved(false);
    const variables: Parameters<typeof revise.mutate>[0] = {
      reason: reason.trim(),
      idempotencyKey: idempotencyKeyRef.current,
    };
    if (title.trim().length > 0 && title.trim() !== goalTitle) {
      variables.title = title.trim();
    }
    if (purpose.trim().length > 0) {
      variables.purpose = purpose.trim();
    }
    const parsedMinutes = Number(dailyMinutes);
    if (Number.isFinite(parsedMinutes) && parsedMinutes > 0) {
      variables.dailyMinutes = parsedMinutes;
    }
    revise.mutate(variables, {
      onSuccess: () => {
        idempotencyKeyRef.current = null;
        setSaved(true);
      },
    });
  };

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        className="self-start text-xs font-medium text-[var(--color-accent)]"
        onClick={() => setOpen((current) => !current)}
      >
        {open ? "收起编辑学习目标" : "编辑学习目标"}
      </button>
      {open && (
        <div className="flex flex-col gap-1.5">
          <Input
            aria-label="学习目标标题"
            value={title}
            onChange={(event) => {
              if (title !== event.target.value) {
                idempotencyKeyRef.current = null;
              }
              setTitle(event.target.value);
              setSaved(false);
            }}
            disabled={revise.isPending}
          />
          <Input
            aria-label="学习目的"
            value={purpose}
            onChange={(event) => {
              if (purpose !== event.target.value) {
                idempotencyKeyRef.current = null;
              }
              setPurpose(event.target.value);
              setSaved(false);
            }}
            placeholder="学习目的（可选）"
            disabled={revise.isPending}
          />
          <Input
            aria-label="每日学习分钟数"
            type="number"
            min={1}
            max={1440}
            value={dailyMinutes}
            onChange={(event) => {
              if (dailyMinutes !== event.target.value) {
                idempotencyKeyRef.current = null;
              }
              setDailyMinutes(event.target.value);
              setSaved(false);
            }}
            placeholder="每日学习分钟数（可选）"
            disabled={revise.isPending}
          />
          <Textarea
            aria-label="修订说明"
            value={reason}
            onChange={(event) => {
              if (reason !== event.target.value) {
                idempotencyKeyRef.current = null;
              }
              setReason(event.target.value);
              setSaved(false);
            }}
            placeholder="说明为什么修改学习目标（必填）"
            disabled={revise.isPending}
            className="min-h-16 text-sm"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={save}
              disabled={!canSave || revise.isPending}
            >
              {revise.isPending ? "保存中…" : "保存修订"}
            </Button>
            <div aria-live="polite">
              {revise.isError && (
                <p role="alert" className="text-xs text-[var(--color-error)]">
                  保存修订失败，请重试。
                </p>
              )}
              {saved && !revise.isPending && !revise.isError && (
                <p role="status" className="text-xs text-[var(--color-text-secondary)]">
                  已保存修订。
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface ProfileResetControlsProps {
  projectId: string;
  goalId: string;
}

function ProfileResetControls({
  projectId,
  goalId,
}: ProfileResetControlsProps) {
  const resetGoal = useResetLearningProfile(projectId, goalId);
  const resetAll = useResetLearningProfile(projectId, goalId);
  const [pendingKind, setPendingKind] = useState<"goal" | "user" | null>(null);

  const perform = (kind: "goal" | "user") => {
    if (pendingKind !== kind) {
      setPendingKind(kind);
      return;
    }
    setPendingKind(null);
    if (kind === "goal") {
      resetGoal.mutate({
        scope: { kind: "goal", goalId },
      });
    } else {
      resetAll.mutate({ scope: { kind: "user" } });
    }
  };

  const isBusy = resetGoal.isPending || resetAll.isPending;

  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--color-text-tertiary)]">
      <button
        type="button"
        onClick={() => perform("goal")}
        disabled={isBusy}
        className="font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
      >
        {pendingKind === "goal"
          ? "再次点击确认重置本学习画像"
          : "重置本学习画像"}
      </button>
      <span aria-hidden="true">·</span>
      <button
        type="button"
        onClick={() => perform("user")}
        disabled={isBusy}
        className="font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
      >
        {pendingKind === "user"
          ? "再次点击确认重置全部学习画像"
          : "重置全部学习画像"}
      </button>
      <div aria-live="polite">
        {(resetGoal.isError || resetAll.isError) && (
          <p role="alert" className="text-[var(--color-error)]">
            重置失败，请重试。
          </p>
        )}
        {!isBusy &&
          !resetGoal.isError &&
          !resetAll.isError &&
          pendingKind === null && (
            <p className="text-[var(--color-text-tertiary)]">
              重置后旧证据不再影响掌握度与推荐，历史记录仍会保留。
            </p>
          )}
      </div>
    </div>
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
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
          {history.goal.title}
        </h2>
        <GoalRevisionEditor
          projectId={projectId}
          goalId={goalId}
          goalTitle={history.goal.title}
        />
      </div>
      <p className="text-xs text-[var(--color-text-secondary)]">
        知识点 {summary.totalPoints} · 薄弱点 {summary.weakPoints} · 到期复习{" "}
        {summary.dueReviews} · 作答 {summary.attempts} 次 · 人工修正{" "}
        {summary.manualCorrections} 次
      </p>
      <ProfileResetControls projectId={projectId} goalId={goalId} />
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
