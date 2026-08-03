"use client";

import { useRef, useState } from "react";
import {
  createIdempotencyKey,
  type AttemptAnswer,
  type AttemptResultDto,
  type ItemFeedbackDto,
  type LearningSessionClientDto,
} from "@/lib/hooks/use-learning-api";
import {
  useRecordAnswerExposure,
  useRecordHint,
  useSubmitAttempt,
} from "@/lib/hooks/use-learning-session";
import { EmptyState } from "@/components/learning/empty-state";
import { PracticeFeedback } from "@/components/learning/practice-feedback";
import { PracticeItemCard } from "@/components/learning/practice-item-card";
import { Button } from "@/components/ui/button";

export interface PracticeSessionProps {
  projectId: string;
  goalId: string;
  session: LearningSessionClientDto;
  onSessionUpdated?: () => void;
  onExit?: () => void;
}

type Phase = "answering" | "submitting" | "feedback";

function isEmptyAnswer(answer: AttemptAnswer | null): boolean {
  if (answer === null) return true;
  if (typeof answer === "string") return answer.trim() === "";
  if (Array.isArray(answer)) return answer.length === 0;
  return false;
}

function stableAnswerSignature(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableAnswerSignature).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableAnswerSignature(record[key])}`
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * In-page practice flow: answering → submitting → feedback per item.
 * Pre-submit renders consume only public DTOs; `explanation` shows up only
 * after a successful submit (AttemptResultDto.feedback) or an explicit
 * answer exposure confirmed by the student.
 */
export function PracticeSession({
  projectId,
  goalId,
  session,
  onSessionUpdated,
  onExit,
}: PracticeSessionProps) {
  const items = session.items;
  const firstOpenIndex = items.findIndex((item) => item.status !== "completed");

  const [currentIndex, setCurrentIndex] = useState(
    firstOpenIndex === -1 ? items.length : firstOpenIndex
  );
  const [phase, setPhase] = useState<Phase>("answering");
  const [answer, setAnswer] = useState<AttemptAnswer | null>(null);
  const [result, setResult] = useState<AttemptResultDto | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [confirmingExposure, setConfirmingExposure] = useState(false);
  const [exposedFeedback, setExposedFeedback] =
    useState<ItemFeedbackDto | null>(null);
  const hintKeyRef = useRef<{ itemId: string; key: string } | null>(null);
  const exposureKeyRef = useRef<{ itemId: string; key: string } | null>(null);
  // Reuse the key only when retrying the exact same item and answer. If the
  // learner edits the answer after a failed request, that is a new logical
  // attempt and must not reuse a key tied to a different request body.
  const attemptKeyRef = useRef<{
    itemId: string;
    answerSignature: string;
    key: string;
  } | null>(null);

  const recordHint = useRecordHint(projectId, session.id);
  const recordAnswerExposure = useRecordAnswerExposure(projectId, session.id);
  const submitAttempt = useSubmitAttempt(projectId, session.id);

  // A refetch can mark the session completed immediately after the final
  // submit. Keep that final feedback visible until the student explicitly
  // presses “完成”; an already-completed session still opens on its end state.
  const isFinished =
    currentIndex >= items.length ||
    (session.status === "completed" && result === null);

  if (isFinished) {
    return (
      <EmptyState
        title="本次练习完成"
        description="所有题目都已完成，可以回到目标页查看掌握度变化。"
        action={
          onExit ? (
            <Button variant="secondary" onClick={onExit}>
              返回
            </Button>
          ) : undefined
        }
      />
    );
  }

  const sessionItem = items[currentIndex];
  const item = sessionItem.practiceItem;
  const isLast = currentIndex === items.length - 1;
  const submitting = phase === "submitting";

  function resetItemState() {
    setAnswer(null);
    setResult(null);
    setSubmitError(null);
    setHint(null);
    setConfirmingExposure(false);
    setExposedFeedback(null);
    setPhase("answering");
  }

  function handleSubmit() {
    if (isEmptyAnswer(answer) || answer === null) return;
    const answerSignature = stableAnswerSignature(answer);
    if (
      attemptKeyRef.current?.itemId !== sessionItem.id ||
      attemptKeyRef.current.answerSignature !== answerSignature
    ) {
      attemptKeyRef.current = {
        itemId: sessionItem.id,
        answerSignature,
        key: createIdempotencyKey(),
      };
    }
    setSubmitError(null);
    setPhase("submitting");
    submitAttempt.mutate(
      {
        sessionItemId: sessionItem.id,
        answer,
        goalId,
        idempotencyKey: attemptKeyRef.current.key,
      },
      {
        onSuccess: (data) => {
          setResult(data);
          setPhase("feedback");
          onSessionUpdated?.();
        },
        onError: () => {
          setPhase("answering");
          setSubmitError("提交失败，请检查网络后重试");
        },
      }
    );
  }

  function handleHint() {
    if (hintKeyRef.current?.itemId !== sessionItem.id) {
      hintKeyRef.current = {
        itemId: sessionItem.id,
        key: createIdempotencyKey(),
      };
    }
    recordHint.mutate(
      {
        sessionItemId: sessionItem.id,
        idempotencyKey: hintKeyRef.current.key,
      },
      {
        onSuccess: (data) => setHint(data.hint),
      }
    );
  }

  function handleExposure() {
    if (exposureKeyRef.current?.itemId !== sessionItem.id) {
      exposureKeyRef.current = {
        itemId: sessionItem.id,
        key: createIdempotencyKey(),
      };
    }
    recordAnswerExposure.mutate(
      {
        sessionItemId: sessionItem.id,
        idempotencyKey: exposureKeyRef.current.key,
      },
      {
        onSuccess: (data) => {
          setExposedFeedback(data.feedback);
          setConfirmingExposure(false);
        },
      }
    );
  }

  function handleNext() {
    attemptKeyRef.current = null;
    setCurrentIndex(isLast ? items.length : currentIndex + 1);
    resetItemState();
  }

  const exposureControl =
    !exposedFeedback &&
    (confirmingExposure ? (
      <span className="flex items-center gap-2">
        <span className="text-xs text-[var(--color-text-secondary)]">
          查看答案后，本题对掌握度的影响会降低
        </span>
        <Button
          variant="secondary"
          onClick={handleExposure}
          disabled={recordAnswerExposure.isPending}
        >
          {recordAnswerExposure.isPending ? "获取中…" : "确认查看"}
        </Button>
        <Button
          variant="ghost"
          onClick={() => setConfirmingExposure(false)}
        >
          取消
        </Button>
      </span>
    ) : (
      <Button
        variant="secondary"
        onClick={() => setConfirmingExposure(true)}
        disabled={submitting}
      >
        查看答案
      </Button>
    ));

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-[var(--color-text-tertiary)]">
        {`第 ${currentIndex + 1} / ${items.length} 题`}
      </p>

      {phase === "feedback" && result ? (
        <div
          key={`feedback-${currentIndex}`}
          className="workbench-view-enter flex flex-col gap-4"
        >
          <h3 className="break-words text-base font-medium text-[var(--color-text-primary)]">
            {item.prompt}
          </h3>
          <PracticeFeedback result={result} />
          {!result.feedback.explanation && exposedFeedback?.explanation && (
            <section className="flex flex-col gap-1">
              <h4 className="text-sm font-medium text-[var(--color-text-primary)]">
                解析
              </h4>
              <p className="text-sm text-[var(--color-text-secondary)]">
                {exposedFeedback.explanation}
              </p>
            </section>
          )}
          {!result.feedback.explanation && exposureControl}
          <Button onClick={handleNext} className="self-start">
            {isLast ? "完成" : "下一题"}
          </Button>
        </div>
      ) : (
        <div
          key={`answer-${currentIndex}`}
          className="workbench-view-enter flex flex-col gap-4"
        >
          <PracticeItemCard
            item={item}
            value={answer}
            onChange={setAnswer}
            disabled={submitting}
          />

          {hint && (
            <p className="workbench-view-enter rounded-[var(--radius-md)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-secondary)]">
              {hint}
            </p>
          )}

          {exposedFeedback?.explanation && (
            <section className="workbench-view-enter flex flex-col gap-1">
              <h4 className="text-sm font-medium text-[var(--color-text-primary)]">
                解析
              </h4>
              <p className="text-sm text-[var(--color-text-secondary)]">
                {exposedFeedback.explanation}
              </p>
            </section>
          )}

          {submitError && (
            <p role="alert" className="workbench-view-enter text-sm text-[var(--color-error)]">
              {submitError}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={handleSubmit}
              disabled={isEmptyAnswer(answer) || submitting}
            >
              {submitting ? "提交中…" : "提交答案"}
            </Button>
            {hint ? (
              <Button variant="ghost" disabled>
                已查看提示
              </Button>
            ) : (
              <Button
                variant="secondary"
                onClick={handleHint}
                disabled={submitting || recordHint.isPending}
              >
                {recordHint.isPending ? "获取中…" : "提示"}
              </Button>
            )}
            {session.mode === "review" && exposureControl}
          </div>
          {recordHint.isError ? (
            <p role="alert" className="workbench-view-enter text-sm text-[var(--color-error)]">
              提示获取失败，请重试
            </p>
          ) : null}
          {recordAnswerExposure.isError ? (
            <p role="alert" className="workbench-view-enter text-sm text-[var(--color-error)]">
              答案获取失败，请重试
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
