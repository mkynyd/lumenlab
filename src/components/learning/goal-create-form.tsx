"use client";

import { useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createIdempotencyKey } from "@/lib/hooks/use-learning-api";
import type { LearningGoalDto } from "@/lib/hooks/use-learning-api";
import { useCreateLearningGoal } from "@/lib/hooks/use-learning-goals";
import { friendlyLearningError } from "@/components/learning/learning-error";

export interface GoalCreateFormProps {
  projectId: string;
  onCreated?: (goal: LearningGoalDto) => void;
  onCancel?: () => void;
}

/**
 * Learning-goal creation form. The idempotency key is bound to the submitted
 * field snapshot: retries of the same values reuse the key (server dedupes),
 * while editing any field after a failed submit starts a new key (a new
 * logical request). It resets after a successful create or a cancel.
 */
export function GoalCreateForm({
  projectId,
  onCreated,
  onCancel,
}: GoalCreateFormProps) {
  const createGoal = useCreateLearningGoal(projectId);
  const idempotencyRef = useRef<{ key: string; signature: string } | null>(
    null
  );
  const fieldId = useId();

  const [title, setTitle] = useState("");
  const [purpose, setPurpose] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [dailyMinutes, setDailyMinutes] = useState("");

  const isPending = createGoal.isPending;
  const canSubmit = title.trim().length > 0 && !isPending;

  function resetForm() {
    setTitle("");
    setPurpose("");
    setTargetDate("");
    setDailyMinutes("");
    idempotencyRef.current = null;
  }

  function handleCancel() {
    resetForm();
    onCancel?.();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle || isPending) return;

    const parsedMinutes = dailyMinutes.trim()
      ? Number.parseInt(dailyMinutes.trim(), 10)
      : null;

    const variables = {
      title: trimmedTitle,
      purpose: purpose.trim() ? purpose.trim() : null,
      targetDate: targetDate
        ? format(new Date(`${targetDate}T00:00:00`), "yyyy-MM-dd'T'HH:mm:ssXXX")
        : null,
      dailyMinutes:
        parsedMinutes !== null && Number.isFinite(parsedMinutes)
          ? parsedMinutes
          : null,
    };
    const signature = JSON.stringify(variables);
    if (
      !idempotencyRef.current ||
      idempotencyRef.current.signature !== signature
    ) {
      idempotencyRef.current = { key: createIdempotencyKey(), signature };
    }

    createGoal.mutate(
      {
        ...variables,
        idempotencyKey: idempotencyRef.current.key,
      },
      {
        onSuccess: (data) => {
          resetForm();
          onCreated?.(data.goal);
        },
      }
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div>
        <label
          htmlFor={`${fieldId}-title`}
          className="mb-1 block text-sm text-[var(--color-text-secondary)]"
        >
          目标标题
        </label>
        <Input
          id={`${fieldId}-title`}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          required
          maxLength={160}
          placeholder="例如：数据结构期末复习"
        />
      </div>

      <div>
        <label
          htmlFor={`${fieldId}-purpose`}
          className="mb-1 block text-sm text-[var(--color-text-secondary)]"
        >
          用途
        </label>
        <Textarea
          id={`${fieldId}-purpose`}
          value={purpose}
          onChange={(event) => setPurpose(event.target.value)}
          placeholder="为什么学、学到什么程度（可选）"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor={`${fieldId}-target-date`}
            className="mb-1 block text-sm text-[var(--color-text-secondary)]"
          >
            目标日期
          </label>
          <DatePicker
            id={`${fieldId}-target-date`}
            value={targetDate || null}
            onChange={(value) => setTargetDate(value ?? "")}
            placeholder="选择目标日期（可选）"
          />
        </div>
        <div>
          <label
            htmlFor={`${fieldId}-daily-minutes`}
            className="mb-1 block text-sm text-[var(--color-text-secondary)]"
          >
            每天投入分钟
          </label>
          <Input
            id={`${fieldId}-daily-minutes`}
            type="number"
            min={5}
            max={480}
            inputMode="numeric"
            value={dailyMinutes}
            onChange={(event) => setDailyMinutes(event.target.value)}
            placeholder="5 - 480（可选）"
          />
        </div>
      </div>

      {createGoal.error && (
        <p role="alert" className="workbench-view-enter text-sm text-[var(--color-error)]">
          {friendlyLearningError(createGoal.error)}
        </p>
      )}

      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button
            type="button"
            variant="ghost"
            onClick={handleCancel}
            disabled={isPending}
          >
            取消
          </Button>
        )}
        <Button type="submit" disabled={!canSubmit}>
          {isPending ? "创建中…" : "创建学习目标"}
        </Button>
      </div>
    </form>
  );
}
