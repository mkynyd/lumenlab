"use client";

import { useState, useCallback, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";

export interface Step {
  id: string;
  title: string;
  description?: string;
  content: ReactNode;
  isValid?: boolean;
}

interface StepperProps {
  steps: Step[];
  currentStep: number;
  onStepChange: (next: number) => void;
  onComplete?: () => void;
  onSkip?: () => void;
  /** 锁定上一步/下一步按钮,不改写 step.content;
   * 加载动画由 step 自己的 content 负责(例如 RotatingText) */
  isCompleting?: boolean;
  skipLabel?: string;
  nextLabel?: string;
  completeLabel?: string;
  className?: string;
}

export function Stepper({
  steps,
  currentStep,
  onStepChange,
  onComplete,
  onSkip,
  isCompleting = false,
  skipLabel = "Skip",
  nextLabel = "Next",
  completeLabel = "Finish",
  className,
}: StepperProps) {
  const isFirst = currentStep === 0;
  const isLast = currentStep === steps.length - 1;
  const [direction, setDirection] = useState<"forward" | "backward">("forward");
  const [hasNavigated, setHasNavigated] = useState(false);

  const transitionTo = useCallback((nextStep: number) => {
    if (nextStep === currentStep) return;
    setDirection(nextStep > currentStep ? "forward" : "backward");
    setHasNavigated(true);
    onStepChange(nextStep);
  }, [currentStep, onStepChange]);

  const handleNext = useCallback(() => {
    if (isLast) {
      onComplete?.();
    } else {
      transitionTo(currentStep + 1);
    }
  }, [isLast, currentStep, onComplete, transitionTo]);

  const handlePrev = useCallback(() => {
    if (!isFirst) {
      transitionTo(currentStep - 1);
    }
  }, [isFirst, currentStep, transitionTo]);

  return (
    <div className={cn("flex flex-col", className)}>
      {/* Step indicators */}
      <nav aria-label="Progress" className="mb-8">
        <ol className="flex items-center">
          {steps.map((step, index) => {
            const isComplete = index < currentStep;
            const isCurrent = index === currentStep;

            return (
              <li key={step.id} className={cn("flex items-center", index > 0 && "flex-1")}>
                {index > 0 && (
                  <div
                    className={cn(
                      "h-px flex-1 transition-colors duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]",
                      isComplete || isCurrent
                        ? "bg-[var(--color-accent)]"
                        : "bg-[var(--color-panel-muted)]"
                    )}
                  />
                )}
                <button
                  type="button"
                  onClick={() => { if (isComplete) transitionTo(index); }}
                  disabled={!isComplete && !isCurrent}
                  className={cn(
                    "relative flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition-colors duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]",
                    isComplete && "text-[var(--color-accent)]",
                    isCurrent && "text-[var(--color-accent)]",
                    !isComplete && !isCurrent && "text-[var(--color-text-tertiary)]"
                  )}
                >
                  <span
                    className={cn(
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-[background-color,color,box-shadow] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]",
                      isComplete && "bg-[var(--color-accent)] text-[var(--color-accent-contrast)]",
                      isCurrent && "bg-[var(--color-accent)] text-[var(--color-accent-contrast)] ring-2 ring-[var(--color-accent-muted)]",
                      !isComplete && !isCurrent && "border border-[var(--color-text-tertiary)] text-[var(--color-text-tertiary)]"
                    )}
                  >
                    {isComplete ? <Check size={12} strokeWidth={2.5} /> : index + 1}
                  </span>
                  <span className="hidden sm:inline">{step.title}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Transitioning from the insertion state keeps successive steps responsive. */}
      <div className="relative min-h-[200px] px-0.5">
        <div
          key={currentStep}
          data-direction={direction}
          className={cn(
            "stepper-content",
            !hasNavigated && "stepper-content-static"
          )}
        >
          {steps[currentStep]?.content}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between mt-8 pt-4 border-t border-[var(--color-panel-muted)]">
        <div>
          {!isFirst && onSkip && (
            <button
              type="button"
              onClick={onSkip}
              className="inline-flex h-8 items-center rounded-[var(--radius-md)] px-3 text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-interaction-hover)] transition-colors duration-150"
            >
              {skipLabel}
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {!isFirst && (
            <button
              type="button"
              onClick={handlePrev}
              disabled={isCompleting}
              className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] px-3 text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-interaction-hover)] transition-colors duration-150 disabled:opacity-50"
            >
              <ChevronLeft size={16} strokeWidth={1.5} />
              Back
            </button>
          )}
          <button
            type="button"
            onClick={handleNext}
            disabled={isCompleting || (steps[currentStep]?.isValid === false)}
            className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] px-4 text-sm font-medium bg-[var(--color-accent)] text-[var(--color-accent-contrast)] hover:bg-[var(--color-accent-hover)] active:translate-y-px transition-[background-color,transform] duration-150 disabled:opacity-50"
          >
            {isLast ? completeLabel : nextLabel}
            {!isLast && <ChevronRight size={16} strokeWidth={1.5} />}
          </button>
        </div>
      </div>
    </div>
  );
}
