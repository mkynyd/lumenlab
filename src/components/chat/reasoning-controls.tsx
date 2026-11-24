"use client";

import { Slider as SliderPrimitive } from "radix-ui";
import {
  providerForChatModel,
  REASONING_EFFORT_LEVELS,
  type ReasoningEffortLevel,
} from "@/lib/chat/model-catalog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const EFFORT_LABELS: Record<ReasoningEffortLevel, string> = {
  low: "低",
  high: "高",
  max: "最高",
};

export function ReasoningControls({
  model,
  value,
  onChange,
  disabled,
}: {
  model?: string;
  value: ReasoningEffortLevel;
  onChange: (value: ReasoningEffortLevel) => void;
  disabled?: boolean;
}) {
  if (model && providerForChatModel(model) !== "deepseek") {
    return (
      <ToggleGroup
        type="single"
        value={value === "max" ? "max" : "high"}
        onValueChange={(next) => {
          if (next === "high" || next === "max") onChange(next);
        }}
        disabled={disabled}
        spacing={1}
        aria-label="思考深度"
        className="grid w-full grid-cols-2 rounded-full bg-[var(--color-panel-muted)] p-1"
      >
        <ToggleGroupItem value="high" className="h-9 rounded-full text-xs">快速</ToggleGroupItem>
        <ToggleGroupItem value="max" className="h-9 rounded-full text-xs">深度</ToggleGroupItem>
      </ToggleGroup>
    );
  }

  return (
    <div className="chat-reasoning-slider rounded-[var(--radius-lg)] px-2 pb-2" data-effort={value}>
      <SliderPrimitive.Root
        value={[REASONING_EFFORT_LEVELS.indexOf(value)]}
        min={0}
        max={REASONING_EFFORT_LEVELS.length - 1}
        step={1}
        disabled={disabled}
        onValueChange={([index]) => {
          const next = REASONING_EFFORT_LEVELS[index];
          if (next) onChange(next);
        }}
        className="chat-reasoning-slider-control relative flex min-h-11 w-full touch-none select-none items-center data-disabled:opacity-50"
      >
        <SliderPrimitive.Track className="chat-reasoning-slider-track relative h-3 w-full overflow-hidden rounded-full">
          <SliderPrimitive.Range className="chat-reasoning-slider-range absolute inset-y-0 rounded-full" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          aria-label="思考深度"
          aria-valuetext={EFFORT_LABELS[value]}
          className="chat-reasoning-slider-thumb block h-6 w-4 rounded-full outline-none"
        />
      </SliderPrimitive.Root>
      <div aria-hidden className="grid grid-cols-3 items-center px-1 text-xs">
        {REASONING_EFFORT_LEVELS.map((level) => (
          <span
            key={level}
            data-selected={value === level}
            className="chat-reasoning-slider-label justify-self-center first:justify-self-start last:justify-self-end"
          >
            {EFFORT_LABELS[level]}
          </span>
        ))}
      </div>
    </div>
  );
}
