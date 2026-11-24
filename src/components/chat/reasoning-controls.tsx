"use client";

import { useId, useState } from "react";
import { Check, ChevronDown, RotateCcw, Zap } from "lucide-react";
import { Slider as SliderPrimitive } from "radix-ui";
import {
  chatModelLabel,
  providerForChatModel,
  REASONING_EFFORT_LEVELS,
  type ReasoningEffortLevel,
} from "@/lib/chat/model-catalog";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

const EFFORT_LABELS: Record<ReasoningEffortLevel, string> = {
  low: "低",
  high: "高",
  max: "最高",
};

export function ReasoningControls({
  model,
  models,
  onModelChange,
  value,
  onChange,
  disabled,
}: {
  model?: string;
  models?: readonly { value: string; label: string }[];
  onModelChange?: (model: string) => void;
  value: ReasoningEffortLevel;
  onChange: (value: ReasoningEffortLevel) => void;
  disabled?: boolean;
}) {
  const modelsId = useId();
  const [modelsOpen, setModelsOpen] = useState(false);
  const modelLabel = model ? chatModelLabel(model) : undefined;

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

  const canChooseModel = Boolean(onModelChange && models?.length);
  return (
    <div className="chat-reasoning-slider rounded-[var(--radius-lg)] px-4 pb-2 pt-2" data-effort={value}>
      <div className="grid grid-cols-[2.25rem_minmax(0,1fr)_2.25rem] items-start gap-1">
        <Zap aria-hidden className="mt-2 size-4 justify-self-center text-[var(--color-text-tertiary)]" strokeWidth={1.75} />
        <div className="flex min-w-0 flex-col items-center">
          <span className="chat-reasoning-slider-label text-lg font-semibold leading-7">{EFFORT_LABELS[value]}</span>
          {canChooseModel ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              aria-label={`切换模型：${modelLabel}`}
              aria-controls={modelsId}
              aria-expanded={modelsOpen}
              onClick={() => setModelsOpen((open) => !open)}
              className="h-8 max-w-full rounded-full px-2 text-[var(--color-text-secondary)]"
            >
              <span className="truncate">{modelLabel}</span>
              <ChevronDown
                aria-hidden
                className={cn("size-3 transition-transform motion-reduce:transition-none", modelsOpen && "rotate-180")}
              />
            </Button>
          ) : (
            modelLabel && <span className="truncate text-sm text-[var(--color-text-secondary)]">{modelLabel}</span>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={disabled || value === "max"}
          aria-label="重置思考深度"
          onClick={() => onChange("max")}
          className="size-9 justify-self-center rounded-full text-[var(--color-text-secondary)]"
        >
          <RotateCcw aria-hidden />
        </Button>
      </div>
      {canChooseModel && (
        <div
          id={modelsId}
          className="chat-model-details"
          data-expanded={modelsOpen}
          inert={!modelsOpen}
          aria-hidden={!modelsOpen}
        >
          <div className="min-h-0 overflow-hidden">
            <ToggleGroup
              type="single"
              orientation="vertical"
              value={model ?? ""}
              aria-label="模型"
              disabled={disabled}
              spacing={1}
              className="grid w-full gap-0.5 py-1"
              onValueChange={(next) => {
                if (!next) return;
                setModelsOpen(false);
                onModelChange?.(next);
              }}
            >
              {models?.map((option) => (
                <ToggleGroupItem key={option.value} value={option.value} className="h-11 w-full justify-between rounded-xl px-3 md:h-9">
                  <span className="truncate">{option.label}</span>
                  {model === option.value && <Check aria-hidden className="size-4" />}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        </div>
      )}
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
        className="chat-reasoning-slider-control relative mt-1 flex h-14 w-full touch-none select-none items-center data-disabled:opacity-50"
      >
        <SliderPrimitive.Track className="chat-reasoning-slider-track relative h-8 w-full overflow-hidden rounded-full">
          <SliderPrimitive.Range className="chat-reasoning-slider-range absolute inset-y-0 rounded-full" />
          <div aria-hidden className="pointer-events-none absolute inset-y-0 inset-x-[1.125rem] flex items-center justify-between">
            {REASONING_EFFORT_LEVELS.map((level) => (
              <span key={level} className="chat-reasoning-slider-mark size-1.5 rounded-full" />
            ))}
          </div>
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          aria-label="思考深度"
          aria-valuetext={EFFORT_LABELS[value]}
          className="chat-reasoning-slider-thumb grid size-10 place-items-center rounded-full outline-none"
        >
          <span aria-hidden className="chat-reasoning-slider-indicator size-2.5 rounded-full" />
        </SliderPrimitive.Thumb>
      </SliderPrimitive.Root>
    </div>
  );
}
