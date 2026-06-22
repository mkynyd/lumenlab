"use client";

import { useState, useCallback, useRef, useEffect, type ReactNode } from "react";
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
  onStepChange: (next: number) => void;
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
  completeLabel = "Finish",
  className,
}: StepperProps) {
  const isFirst = currentStep === 0;
  const isLast = currentStep === steps.length - 1;
  const [animating, setAnimating] = useState(false);
  const [direction, setDirection] = useState<"forward" | "backward">("forward");
  const prevStep = useRef(currentStep);

  useEffect(() => {
    if (currentStep !== prevStep.current) {
      setDirection(currentStep > prevStep.current ? "forward" : "backward");
      setAnimating(true);
      const timer = setTimeout(() => setAnimating(false), 300);
      prevStep.current = currentStep;
      return () => clearTimeout(timer);
    }
  }, [currentStep]);

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
                      "h-px flex-1 transition-colors duration-300",
                      isComplete || isCurrent
                        ? "bg-[var(--color-accent)]"
                        : "bg-[var(--color-panel-muted)]"
                    )}
                  />
                )}
                <button
                  type="button"
                  onClick={() => { if (isComplete) onStepChange(index); }}
                  disabled={!isComplete && !isCurrent}
                  className={cn(
                    "relative flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition-all duration-300",
                    isComplete && "text-[var(--color-accent)]",
                    isCurrent && "text-[var(--color-accent)]",
                    !isComplete && !isCurrent && "text-[var(--color-text-tertiary)]"
                  )}
                >
                  <span
                    className={cn(
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-all duration-300",
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

      {/* Animated step content */}
      <div className="relative min-h-[200px] px-0.5">
        <div
          className={cn(
            "transition-all duration-300 ease-out",
            animating && direction === "forward" && "animate-in slide-in-from-right-4 fade-in",
            animating && direction === "backward" && "animate-in slide-in-from-left-4 fade-in"
          )}
        >
          {isCompleting ? (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <Loader2 size={32} strokeWidth={1.5} className="animate-spin text-[var(--color-accent)]" />
              <p className="text-sm text-[var(--color-text-secondary)]">{completingText}</p>
            </div>
          ) : (
            steps[currentStep]?.content
          )}
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
            className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] px-4 text-sm font-medium bg-[var(--color-accent)] text-[var(--color-accent-contrast)] hover:bg-[var(--color-accent-hover)] active:translate-y-px transition-all duration-150 disabled:opacity-50"
          >
            {isLast ? completeLabel : nextLabel}
            {!isLast && <ChevronRight size={16} strokeWidth={1.5} />}
          </button>
        </div>
      </div>
    </div>
  );
}
