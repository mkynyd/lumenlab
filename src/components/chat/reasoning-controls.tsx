"use client";

import { useEffect, useId, useRef, useState, type PointerEvent } from "react";
import { motion, useReducedMotion, useSpring, type MotionStyle, type MotionValue } from "motion/react";
import { Check, ChevronDown } from "lucide-react";
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

const LAST_EFFORT_INDEX = REASONING_EFFORT_LEVELS.length - 1;
const EFFORT_SPRING = { stiffness: 480, damping: 38, mass: 0.8, restDelta: 0.001, restSpeed: 0.01 };

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
  const selectedIndex = REASONING_EFFORT_LEVELS.indexOf(value);
  const reducedMotion = useReducedMotion();
  const position = useSpring(selectedIndex, EFFORT_SPRING);
  const sliderStyle: MotionStyle & { "--effort-position": MotionValue<number> } = { "--effort-position": position };
  const thumb = useRef<HTMLSpanElement>(null);
  const keyboardThumb = useRef<HTMLSpanElement>(null);
  const drag = useRef<{ id: number; start: number; span: number; offset: number } | null>(null);

  useEffect(() => {
    if (drag.current) return;
    if (reducedMotion) position.jump(selectedIndex);
    else position.set(selectedIndex);
  }, [position, reducedMotion, selectedIndex]);

  function pointerPosition(clientX: number, gesture: NonNullable<typeof drag.current>) {
    const index = ((clientX - gesture.start - gesture.offset) / gesture.span) * LAST_EFFORT_INDEX;
    return Math.max(0, Math.min(LAST_EFFORT_INDEX, index));
  }

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (disabled || event.button !== 0 || drag.current) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const handle = thumb.current;
    if (!handle) return;
    const thumbBounds = handle.getBoundingClientRect();
    const inset = handle.offsetWidth / 2;
    const span = bounds.width - inset * 2;
    if (span <= 0) return;
    const grabbed = event.target instanceof Node && handle.contains(event.target);
    const center = thumbBounds.left + thumbBounds.width / 2;
    const gesture = {
      id: event.pointerId, start: bounds.left + inset, span,
      offset: grabbed ? event.clientX - center : 0,
    };
    drag.current = gesture;
    event.currentTarget.setPointerCapture(event.pointerId);
    keyboardThumb.current?.focus({ preventScroll: true });
    const current = position.get();
    position.jump(current);
    if (!grabbed) {
      const next = pointerPosition(event.clientX, gesture);
      if (reducedMotion) position.jump(next);
      else position.set(next);
    }
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const gesture = drag.current;
    if (!disabled && gesture?.id === event.pointerId) {
      position.jump(pointerPosition(event.clientX, gesture));
    }
  }

  function finishDrag(event: PointerEvent<HTMLDivElement>, commit: boolean) {
    const gesture = drag.current;
    if (gesture?.id !== event.pointerId) return;
    drag.current = null;
    const index = commit && !disabled ? Math.round(pointerPosition(event.clientX, gesture)) : selectedIndex;
    if (reducedMotion) position.jump(index);
    else position.set(index);
    if (index !== selectedIndex) onChange(REASONING_EFFORT_LEVELS[index]);
  }


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
  const levelLabel = EFFORT_LABELS[value];
  return (
    <motion.div
      className="chat-reasoning-slider w-full px-0 pb-1 pt-1"
      style={sliderStyle}
    >
      <div className="flex w-full min-w-0 flex-col items-center gap-1.5">
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
            className="h-7 max-w-full rounded-full px-2 text-[15px] font-normal text-[var(--color-text-primary)]"
          >
            <span className="max-w-[min(62vw,16rem)] truncate font-medium">{modelLabel}</span>
            <span className="chat-reasoning-effort-label">{levelLabel}</span>
            <ChevronDown
              aria-hidden
              className={cn("size-3 text-[var(--color-text-tertiary)] transition-transform motion-reduce:transition-none", modelsOpen && "rotate-180")}
            />
          </Button>
        ) : (
          <span className="flex max-w-full items-center gap-1.5 truncate text-[15px] text-[var(--color-text-secondary)]">
            {modelLabel && <span className="truncate">{modelLabel}</span>}
            <span className="chat-reasoning-effort-label">{levelLabel}</span>
          </span>
        )}
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
                <ToggleGroupItem key={option.value} value={option.value} className="h-10 w-full justify-between rounded-[10px] px-2.5 text-[13px] md:h-9">
                  <span className="truncate">{option.label}</span>
                  {model === option.value && <Check aria-hidden className="size-4" />}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        </div>
      )}
      <div
        className="chat-reasoning-slider-control relative mt-2 flex h-12 w-full touch-pan-y select-none items-center data-disabled:opacity-50"
        data-disabled={disabled || undefined}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={(event) => finishDrag(event, true)}
        onPointerCancel={(event) => finishDrag(event, false)}
        onLostPointerCapture={(event) => finishDrag(event, false)}
      >
        <div aria-hidden className="chat-reasoning-slider-track relative h-full w-full rounded-full border border-[var(--color-border-light)] bg-[var(--color-surface)]">
          <span className="pointer-events-none absolute inset-y-0 inset-x-[1.3125rem] flex items-center justify-between">
            {REASONING_EFFORT_LEVELS.map((effort) => (
              <span key={effort} className="chat-reasoning-slider-mark size-1.5 rounded-full bg-[var(--color-text-tertiary)]/45" />
            ))}
          </span>
          <span className="chat-reasoning-slider-range absolute bottom-[0.3125rem] left-[0.3125rem] top-[0.3125rem] rounded-full bg-[var(--effort-color)]" />
        </div>
        <span
          ref={thumb}
          className="chat-reasoning-slider-thumb pointer-events-auto absolute top-1/2 size-[2.375rem] -translate-y-1/2 rounded-full border-2 border-[var(--effort-color)] bg-[var(--color-surface)]"
        />
        <SliderPrimitive.Root
          value={[selectedIndex]}
          min={0}
          max={LAST_EFFORT_INDEX}
          step={1}
          disabled={disabled}
          onValueChange={([index]) => {
            const next = REASONING_EFFORT_LEVELS[index];
            if (next) onChange(next);
          }}
          className="pointer-events-none absolute inset-0 opacity-0"
        >
          <SliderPrimitive.Thumb
            ref={keyboardThumb}
            aria-label="思考深度"
            aria-valuetext={EFFORT_LABELS[value]}
            className="block size-10"
          />
        </SliderPrimitive.Root>
      </div>
    </motion.div>
  );
}
