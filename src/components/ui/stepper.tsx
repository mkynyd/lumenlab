"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
  /** 支持异步：await 成功后才切步，reject/throw 时停留在当前步 */
  onStepChange: (next: number) => void | Promise<void>;
  /** 支持异步：最后一步的主动作（如提交注册） */
  onComplete?: () => void | Promise<void>;
  onSkip?: () => void;
  /** 锁定上一步/下一步按钮,不改写 step.content;
   * 加载动画由 step 自己的 content 负责(例如 RotatingText) */
  isCompleting?: boolean;
  /** false 时未来步骤不可点击（已完成步骤仍可回跳），默认 true */
  allowForwardJump?: boolean;
  /** await 期间 Next 按钮文案（如「发送中…」），缺省沿用原按钮文案 */
  pendingLabel?: string;
  skipLabel?: string;
  nextLabel?: string;
  completeLabel?: string;
  /** "dots" 时指示条只渲染圆点序号/对勾，当前步骤标题移到内容区上方展示 */
  variant?: "default" | "dots";
  className?: string;
}

export function Stepper({
  steps,
  currentStep,
  onStepChange,
  onComplete,
  onSkip,
  isCompleting = false,
  allowForwardJump = true,
  pendingLabel,
  skipLabel = "Skip",
  nextLabel = "Next",
  completeLabel = "Finish",
  variant = "default",
  className,
}: StepperProps) {
  const isFirst = currentStep === 0;
  const isLast = currentStep === steps.length - 1;
  const [direction, setDirection] = useState<"forward" | "backward">("forward");
  const [hasNavigated, setHasNavigated] = useState(false);
  const [isPending, setIsPending] = useState(false);
  // ref 计数防连点竞态：一次异步切步未结束时忽略后续触发
  const pendingRef = useRef(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const focusTimerRef = useRef<number | null>(null);
  const titleBaseId = useId();
  const stepTitleId = (index: number) => `${titleBaseId}-step-${index}-title`;

  const busy = isCompleting || isPending;

  const runAction = useCallback(async (action: () => void | Promise<void>) => {
    if (pendingRef.current) return false;
    pendingRef.current = true;
    setIsPending(true);
    try {
      await action();
      return true;
    } catch {
      // 错误展示由调用方（action 内部）负责；失败时停留在当前步
      return false;
    } finally {
      pendingRef.current = false;
      setIsPending(false);
    }
  }, []);

  const transitionTo = useCallback(
    (nextStep: number) => {
      if (nextStep === currentStep) return;
      void runAction(async () => {
        await onStepChange(nextStep);
        setDirection(nextStep > currentStep ? "forward" : "backward");
        setHasNavigated(true);
      });
    },
    [currentStep, onStepChange, runAction]
  );

  const handleNext = useCallback(() => {
    if (isLast) {
      if (onComplete) void runAction(onComplete);
    } else {
      transitionTo(currentStep + 1);
    }
  }, [isLast, currentStep, onComplete, runAction, transitionTo]);

  const handlePrev = useCallback(() => {
    if (!isFirst) {
      transitionTo(currentStep - 1);
    }
  }, [isFirst, currentStep, transitionTo]);

  // 未来步骤仅在 allowForwardJump 且之前所有步骤均有效时可点击
  const canJumpTo = useCallback(
    (index: number) => {
      if (index < currentStep) return true;
      if (index === currentStep) return false;
      if (!allowForwardJump) return false;
      return steps.slice(0, index).every((step) => step.isValid !== false);
    },
    [currentStep, allowForwardJump, steps]
  );

  // 焦点管理：步骤切换动画结束后聚焦内容容器（reduced-motion 时立即）
  useEffect(() => {
    if (!hasNavigated) return;
    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      contentRef.current?.focus();
      return;
    }
    focusTimerRef.current = window.setTimeout(() => {
      focusTimerRef.current = null;
      contentRef.current?.focus();
    }, 200);
    return () => {
      if (focusTimerRef.current !== null) {
        window.clearTimeout(focusTimerRef.current);
        focusTimerRef.current = null;
      }
    };
  }, [currentStep, hasNavigated]);

  const handleContentTransitionEnd = useCallback(
    (event: React.TransitionEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget || !hasNavigated) return;
      if (focusTimerRef.current !== null) {
        window.clearTimeout(focusTimerRef.current);
        focusTimerRef.current = null;
      }
      contentRef.current?.focus();
    },
    [hasNavigated]
  );

  return (
    <div className={cn("flex flex-col", className)}>
      {/* Step indicators */}
      <nav aria-label="Progress" className="mb-8">
        <ol className="flex items-center">
          {steps.map((step, index) => {
            const isComplete = index < currentStep;
            const isCurrent = index === currentStep;
            const jumpable = canJumpTo(index);

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
                  onClick={() => { if (jumpable) transitionTo(index); }}
                  disabled={(!isComplete && !isCurrent && !jumpable) || busy}
                  aria-current={isCurrent ? "step" : undefined}
                  aria-label={variant === "dots" ? step.title : undefined}
                  className={cn(
                    "relative flex items-center rounded-full py-1.5 text-sm font-medium transition-colors duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] touch-manipulation max-sm:min-h-11 max-sm:min-w-11 max-sm:justify-center",
                    variant === "dots" ? "px-1.5" : "gap-2 px-3",
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
                  {variant !== "dots" && (
                    <span id={stepTitleId(index)} className="hidden sm:inline whitespace-nowrap">
                      {step.title}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {/* dots 变体：步骤标题展示在内容区上方，同时充当内容区的 aria-labelledby 目标 */}
      {variant === "dots" && (
        <h2
          id={stepTitleId(currentStep)}
          className="mb-5 px-0.5 text-lg font-semibold text-[var(--color-text-primary)]"
        >
          {steps[currentStep]?.title}
        </h2>
      )}

      {/* Transitioning from the insertion state keeps successive steps responsive. */}
      <div className="relative min-h-[200px] px-0.5">
        <div
          key={currentStep}
          ref={contentRef}
          tabIndex={-1}
          role="group"
          aria-labelledby={stepTitleId(currentStep)}
          data-direction={direction}
          onTransitionEnd={handleContentTransitionEnd}
          className={cn(
            "stepper-content outline-none",
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
              disabled={busy}
              className="inline-flex h-8 items-center rounded-[var(--radius-md)] px-3 text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-interaction-hover)] transition-colors duration-150 disabled:opacity-50"
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
              disabled={busy}
              className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] px-3 text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-interaction-hover)] transition-colors duration-150 disabled:opacity-50"
            >
              <ChevronLeft size={16} strokeWidth={1.5} />
              Back
            </button>
          )}
          <button
            type="button"
            onClick={handleNext}
            disabled={busy || (steps[currentStep]?.isValid === false)}
            className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] px-4 text-sm font-medium bg-[var(--color-accent)] text-[var(--color-accent-contrast)] hover:bg-[var(--color-accent-hover)] active:translate-y-px transition-[background-color,transform] duration-150 disabled:opacity-50"
          >
            {isPending ? (
              <>
                <Loader2 size={16} strokeWidth={1.5} className="animate-spin" />
                {pendingLabel ?? (isLast ? completeLabel : nextLabel)}
              </>
            ) : (
              <>
                {isLast ? completeLabel : nextLabel}
                {!isLast && <ChevronRight size={16} strokeWidth={1.5} />}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
