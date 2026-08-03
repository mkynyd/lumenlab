"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type {
  AttemptAnswer,
  PracticeItemClientDto,
  PracticeOptionDto,
} from "@/lib/hooks/use-learning-api";
import { FreshnessBadge } from "@/components/learning/freshness-badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export interface PracticeItemCardProps {
  item: PracticeItemClientDto;
  value: AttemptAnswer | null;
  onChange: (value: AttemptAnswer) => void;
  disabled?: boolean;
}

const controlLabelClassName = "text-sm text-[var(--color-text-secondary)]";
const optionLabelClassName =
  "cursor-pointer flex items-center gap-2 rounded-[var(--radius-md)] px-2 py-1.5 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors duration-150 motion-reduce:transition-none";

function hasOptions(
  options: PracticeItemClientDto["options"]
): options is PracticeOptionDto[] {
  return Array.isArray(options) && options.length > 0;
}

function TextAnswer({
  answerId,
  value,
  onChange,
  disabled,
  note,
}: {
  answerId: string;
  value: AttemptAnswer | null;
  onChange: (value: AttemptAnswer) => void;
  disabled: boolean;
  note?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {note && (
        <p className="text-xs text-[var(--color-text-secondary)]">{note}</p>
      )}
      <label htmlFor={answerId} className={controlLabelClassName}>
        作答
      </label>
      <Textarea
        id={answerId}
        value={typeof value === "string" ? value : ""}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

/**
 * Renders one practice item's prompt and the answer input for its type.
 * Consumes only the public client DTO: options are part of the question,
 * and explanation/criteria never reach this component.
 */
export function PracticeItemCard({
  item,
  value,
  onChange,
  disabled = false,
}: PracticeItemCardProps) {
  const promptId = `practice-prompt-${item.id}`;
  const answerId = `practice-answer-${item.id}`;
  const rawOptions = item.options;
  const options = hasOptions(rawOptions) ? rawOptions : null;
  const optionsMissing =
    (item.type === "single_choice" || item.type === "multiple_choice") &&
    !options;

  let control: ReactNode;

  if (item.type === "single_choice" && options) {
    control = (
      <div
        role="radiogroup"
        aria-labelledby={promptId}
        className="flex flex-col gap-1"
      >
        {options.map((option) => (
          <label key={option.id} className={optionLabelClassName}>
            <input
              type="radio"
              name={promptId}
              value={option.id}
              checked={value === option.id}
              disabled={disabled}
              onChange={() => onChange(option.id)}
              className="h-4 w-4 accent-[var(--color-accent)]"
            />
            {option.label}
          </label>
        ))}
      </div>
    );
  } else if (item.type === "multiple_choice" && options) {
    const selected = Array.isArray(value) ? value.map(String) : [];
    control = (
      <div
        role="group"
        aria-labelledby={promptId}
        className="flex flex-col gap-1"
      >
        {options.map((option) => (
          <label key={option.id} className={optionLabelClassName}>
            <input
              type="checkbox"
              name={promptId}
              value={option.id}
              checked={selected.includes(option.id)}
              disabled={disabled}
              onChange={() => {
                const next = selected.includes(option.id)
                  ? selected.filter((id) => id !== option.id)
                  : [...selected, option.id];
                onChange(next);
              }}
              className="h-4 w-4 accent-[var(--color-accent)]"
            />
            {option.label}
          </label>
        ))}
      </div>
    );
  } else if (item.type === "true_false") {
    const booleanOptions: Array<{ label: string; optionValue: boolean }> = [
      { label: "正确", optionValue: true },
      { label: "错误", optionValue: false },
    ];
    control = (
      <div
        role="radiogroup"
        aria-labelledby={promptId}
        className="flex flex-col gap-1"
      >
        {booleanOptions.map((option) => (
          <label key={option.label} className={optionLabelClassName}>
            <input
              type="radio"
              name={promptId}
              checked={value === option.optionValue}
              disabled={disabled}
              onChange={() => onChange(option.optionValue)}
              className="h-4 w-4 accent-[var(--color-accent)]"
            />
            {option.label}
          </label>
        ))}
      </div>
    );
  } else if (item.type === "numeric") {
    control = (
      <div className="flex flex-col gap-1.5">
        <label htmlFor={answerId} className={controlLabelClassName}>
          作答
        </label>
        <Input
          id={answerId}
          type="number"
          step="any"
          disabled={disabled}
          value={typeof value === "number" ? String(value) : ""}
          onChange={(event) =>
            onChange(
              event.target.value === "" ? "" : Number(event.target.value)
            )
          }
        />
      </div>
    );
  } else {
    control = (
      <TextAnswer
        answerId={answerId}
        value={value}
        onChange={onChange}
        disabled={disabled}
        note={optionsMissing ? "选项不可用，请用文字作答" : undefined}
      />
    );
  }

  return (
    <section aria-labelledby={promptId} className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <h3
          id={promptId}
          className="break-words text-base font-medium text-[var(--color-text-primary)]"
        >
          {item.prompt}
        </h3>
        <FreshnessBadge freshness={item.freshness} className="shrink-0 pt-1" />
      </div>
      {item.mode === "feedback_only" && (
        <p className="text-xs text-[var(--color-text-secondary)]">
          此题只提供反馈，不影响掌握度
        </p>
      )}
      <div
        className={cn(
          disabled &&
            "opacity-80 transition-opacity duration-150 motion-reduce:transition-none"
        )}
      >
        {control}
      </div>
    </section>
  );
}
