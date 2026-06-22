"use client";

import { useState, useCallback, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Check, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

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
  onStepChange: (index: number) => void;
  onComplete?: () => void;
  onSkip?: () => void;
  isCompleting?: boolean;
  completingText?: string;
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
  completingText = "Processing...",
  skipLabel = "Skip",
  nextLabel = "Next",
  completeLabel = "Enter Workspace",
  className,
}: StepperProps) {
  const isFirst = currentStep === 0;
  const isLast = currentStep === steps.length - 1;

  const handleNext = useCallback(() => {
    if (isLast) {
      onComplete?.();
    } else {
      onStepChange(currentStep + 1);
    }
  }, [isLast, currentStep, onStepChange, onComplete]);

  const handlePrev = useCallback(() => {
    if (!isFirst) {
      onStepChange(currentStep - 1);
    }
  }, [isFirst, currentStep, onStepChange]);

  return (
    <div className={cn("flex flex-col", className)}>
      {/* Step indicators */}
      <nav aria-label="Progress" className="mb-6">
        <ol className="flex items-center gap-2">
          {steps.map((step, index) => {
            const isComplete = index < currentStep;
            const isCurrent = index === currentStep;
            const isUpcoming = index > currentStep;

            return (
              <li key={step.id} className="flex flex-1 items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (isComplete) onStepChange(index);
                  }}
                  disabled={isUpcoming}
                  className={cn(
                    "flex items-center gap-2 rounded-[var(--radius-md)] px-3 py-2 text-sm font-medium transition-colors duration-150",
                    isComplete &&
                      "cursor-pointer text-[var(--color-accent)] hover:bg-[var(--color-accent-muted)]",
                    isCurrent &&
                      "bg-[var(--color-accent)] text-[var(--color-accent-contrast)]",
                    isUpcoming &&
                      "cursor-default text-[var(--color-text-tertiary)]"
                  )}
                >
                  <span
                    className={cn(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                      isComplete &&
                        "bg-[var(--color-accent)] text-[var(--color-accent-contrast)]",
                      isCurrent &&
                        "bg-[var(--color-accent-contrast)] text-[var(--color-accent)]",
                      isUpcoming &&
                        "border border-[var(--color-text-tertiary)] text-[var(--color-text-tertiary)]"
                    )}
                  >
                    {isComplete ? (
                      <Check size={12} strokeWidth={2.5} />
                    ) : (
                      index + 1
                    )}
                  </span>
                  <span className="hidden sm:inline">{step.title}</span>
                </button>
                {index < steps.length - 1 && (
                  <div
                    className={cn(
                      "h-px flex-1",
                      index < currentStep
                        ? "bg-[var(--color-accent)]"
                        : "bg-[var(--color-panel-muted)]"
                    )}
                  />
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Step content */}
      <div className="min-h-[160px]">
        {isCompleting ? (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <Loader2
              size={32}
              strokeWidth={1.5}
              className="animate-spin text-[var(--color-accent)]"
            />
            <p className="text-sm text-[var(--color-text-secondary)]">
              {completingText}
            </p>
          </div>
        ) : (
          steps[currentStep]?.content
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between mt-6 pt-4 border-t border-[var(--color-panel-muted)]">
        <div>
          {!isFirst && onSkip && (
            <button
              type="button"
              onClick={onSkip}
              className={cn(
                "inline-flex h-8 items-center rounded-[var(--radius-md)] px-3 text-sm font-medium",
                "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]",
                "hover:bg-[var(--color-interaction-hover)]",
                "transition-colors duration-150"
              )}
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
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] px-3 text-sm font-medium",
                "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]",
                "hover:bg-[var(--color-interaction-hover)]",
                "transition-colors duration-150",
                "disabled:opacity-50 disabled:pointer-events-none"
              )}
            >
              <ChevronLeft size={16} strokeWidth={1.5} />
              Back
            </button>
          )}
          <button
            type="button"
            onClick={handleNext}
            disabled={isCompleting}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] px-4 text-sm font-medium",
              "bg-[var(--color-accent)] text-[var(--color-accent-contrast)]",
              "hover:bg-[var(--color-accent-hover)]",
              "active:translate-y-px",
              "transition-all duration-150",
              "disabled:opacity-50 disabled:pointer-events-none"
            )}
          >
            {isLast ? completeLabel : nextLabel}
            {!isLast && <ChevronRight size={16} strokeWidth={1.5} />}
          </button>
        </div>
      </div>
    </div>
  );
}
