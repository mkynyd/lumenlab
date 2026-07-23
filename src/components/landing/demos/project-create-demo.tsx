"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Check, FolderOpen, RefreshCw, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RotatingText } from "@/components/ui/rotating-text";
import { MOCK_NEW_PROJECT } from "@/lib/mock/landing-fixtures";
import { usePrefersReducedMotion } from "../prefers-motion";

/**
 * 首页「三步建项目」演示。复刻 /projects/new 表单的全部 4 个步骤：
 *  - 0 基本信息：项目名 + 项目类型 4 卡
 *  - 1 场景描述：自然语言文本
 *  - 2 生成中：RotatingText 动画（与 /projects/new 同款），5.5s 后自动进入下一步
 *  - 3 确认：生成的提示词 + 推荐快捷任务
 * 视觉与 /projects/new 表单一致：不接 API，所有数据来自 MOCK_NEW_PROJECT。
 */

const PROJECT_TYPES = [
  { value: "experiment", label: "实验工作台", desc: "实验数据、报告与计算" },
  { value: "review", label: "资料复习", desc: "考点速记、思维导图" },
  { value: "coding", label: "代码项目", desc: "解释代码、查找 bug" },
  { value: "general", label: "通用项目", desc: "问答、创作、知识管理" },
];

const STEPS = [
  { id: "basics", label: "基本信息" },
  { id: "scene", label: "场景描述" },
  { id: "generating", label: "生成中" },
  { id: "result", label: "确认" },
];

interface ProjectCreateDemoProps {
  className?: string;
}

export function ProjectCreateDemo({ className }: ProjectCreateDemoProps) {
  const [step, setStep] = useState(0);
  const reducedMotion = usePrefersReducedMotion();

  // Step 2 (generating) auto-advance to step 3 after a delay — 模拟 API 返回
  useEffect(() => {
    if (step !== 2) return;
    const timer = window.setTimeout(() => setStep(3), 5500);
    return () => window.clearTimeout(timer);
  }, [step]);

  return (
    <div
      className={cn(
        "flex flex-col rounded-[inherit] bg-[var(--color-surface)] p-5 sm:p-6",
        className
      )}
    >
      <DemoHeader />
      <DemoStepper step={step} onJump={setStep} />

      <div className="relative min-h-[300px]">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={step}
            initial={reducedMotion ? false : { opacity: 0, transform: "translateX(12px)" }}
            animate={{ opacity: 1, transform: "translateX(0px)" }}
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, transform: "translateX(-12px)" }}
            transition={{ duration: 0.24, ease: [0.23, 1, 0.32, 1] }}
          >
            {step === 0 && <BasicsStep />}
            {step === 1 && <SceneStep />}
            {step === 2 && <GeneratingStep />}
            {step === 3 && <ResultStep />}
          </motion.div>
        </AnimatePresence>
      </div>

      <DemoFooter step={step} onNext={() => setStep((s) => Math.min(s + 1, 3))} onPrev={() => setStep((s) => Math.max(s - 1, 0))} onReset={() => setStep(0)} />
    </div>
  );
}

function DemoHeader() {
  return (
    <div className="mb-5 flex items-center gap-3">
      <span className="flex size-9 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-accent)] text-[var(--color-accent-contrast)]">
        <FolderOpen size={18} strokeWidth={1.75} />
      </span>
      <div className="min-w-0">
        <h3 className="text-[15px] font-semibold text-[var(--color-text-primary)]">
          新建项目
        </h3>
        <p className="text-[12px] text-[var(--color-text-secondary)]">
          AI 会根据场景生成项目提示词与快捷任务
        </p>
      </div>
    </div>
  );
}

function DemoStepper({
  step,
  onJump,
}: {
  step: number;
  onJump: (next: number) => void;
}) {
  return (
    <nav aria-label="项目创建步骤" className="mb-6">
      <ol className="flex items-center text-[12px]">
        {STEPS.map((s, i) => {
          const isCurrent = i === step;
          const isComplete = i < step;
          const canJump = isComplete || isCurrent;
          return (
            <li key={s.id} className="flex flex-1 items-center gap-2">
              {i > 0 && (
                <span
                  className={cn(
                    "h-px flex-1 transition-colors duration-300",
                    isComplete || isCurrent
                      ? "bg-[var(--color-accent)]"
                      : "bg-[var(--color-panel-muted)]"
                  )}
                  aria-hidden
                />
              )}
              <button
                type="button"
                onClick={() => canJump && onJump(i)}
                disabled={!canJump}
                aria-current={isCurrent ? "step" : undefined}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-full px-1 py-0.5 transition-colors duration-150",
                  canJump
                    ? "cursor-pointer hover:bg-[var(--color-interaction-hover)]"
                    : "cursor-default"
                )}
              >
                <span
                  className={cn(
                    "flex size-6 items-center justify-center rounded-full text-xs font-semibold transition-colors duration-300",
                    isComplete && "bg-[var(--color-accent)] text-[var(--color-accent-contrast)]",
                    isCurrent && "bg-[var(--color-accent)] text-[var(--color-accent-contrast)]",
                    !isComplete && !isCurrent && "bg-[var(--color-panel-muted)] text-[var(--color-text-tertiary)]"
                  )}
                >
                  {isComplete ? <Check size={12} strokeWidth={2.5} /> : i + 1}
                </span>
                <span
                  className={cn(
                    "hidden font-medium sm:inline",
                    isCurrent
                      ? "text-[var(--color-accent)]"
                      : isComplete
                        ? "text-[var(--color-text-secondary)]"
                        : "text-[var(--color-text-tertiary)]"
                  )}
                >
                  {s.label}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function BasicsStep() {
  return (
    <div className="space-y-5">
      <div>
        <label className="mb-1.5 block text-[13px] font-medium text-[var(--color-text-primary)]">
          项目名称
        </label>
        <Input
          value={MOCK_NEW_PROJECT.name}
          readOnly
          aria-readonly="true"
          className="h-9 text-[14px]"
        />
      </div>
      <div>
        <label className="mb-2 block text-[13px] font-medium text-[var(--color-text-primary)]">
          项目类型
        </label>
        <div className="grid grid-cols-2 gap-2">
          {PROJECT_TYPES.map((pt) => {
            const selected = pt.value === MOCK_NEW_PROJECT.type;
            return (
              <div
                key={pt.value}
                role="img"
                aria-label={`${pt.label}${selected ? " 已选中" : ""}`}
                className={cn(
                  "min-h-12 text-left rounded-[var(--radius-md)] p-3",
                  selected
                    ? "bg-[var(--color-accent-muted)]"
                    : "bg-[var(--color-panel-muted)]"
                )}
              >
                <span
                  className={cn(
                    "block text-[13px]",
                    selected
                      ? "font-semibold text-[var(--color-accent)]"
                      : "font-medium text-[var(--color-text-primary)]"
                  )}
                >
                  {pt.label}
                </span>
                <p className="mt-0.5 text-xs text-[var(--color-text-tertiary)]">
                  {pt.desc}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SceneStep() {
  return (
    <div className="space-y-3">
      <label className="block text-[13px] font-medium text-[var(--color-text-primary)]">
        描述你的使用场景
      </label>
      <p className="text-[12px] text-[var(--color-text-secondary)]">
        用自然语言告诉 AI 你的背景和目的，AI 会据此生成专属的项目提示词和快捷任务。
      </p>
      <Textarea
        value={MOCK_NEW_PROJECT.sceneDescription}
        readOnly
        aria-readonly="true"
        className="h-32 resize-none text-[13px] leading-relaxed"
      />
    </div>
  );
}

function GeneratingStep() {
  return (
    <div className="flex flex-col items-center justify-center py-10">
      <RotatingText
        texts={[
          "Thinking",
          "Exploring",
          "Generating",
          "Personalizing",
          "Building",
        ]}
        interval={2400}
        staggerDuration={0.028}
        prefix="Lumen"
        mainClassName="items-baseline gap-3 text-[28px] font-medium tracking-tight text-[var(--color-text-primary)] sm:text-[32px]"
        prefixClassName="text-[var(--color-text-primary)]"
        rotatingWrapperClassName={cn(
          "rounded-lg px-3 py-1.5 text-[var(--color-accent-contrast)]",
          "bg-[var(--color-accent)]"
        )}
      />
      <p className="mt-6 text-[12px] text-[var(--color-text-tertiary)]">
        AI 正在为你的项目生成提示词与推荐快捷任务
      </p>
    </div>
  );
}

function ResultStep() {
  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-[13px] font-medium text-[var(--color-text-primary)]">
          生成的提示词
        </p>
        <div className="max-h-40 overflow-y-auto rounded-[var(--radius-md)] bg-[var(--color-panel-muted)] p-3">
          <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-[var(--color-text-secondary)]">
            {MOCK_NEW_PROJECT.generatedPrompt}
          </p>
        </div>
      </div>
      <div>
        <p className="mb-2 text-[13px] font-medium text-[var(--color-text-primary)]">
          推荐快捷任务
        </p>
        <div className="space-y-2">
          {MOCK_NEW_PROJECT.quickActions.map((action, i) => (
            <div
              key={i}
              className={cn(
                "rounded-[var(--radius-md)] p-3",
                i === 0
                  ? "bg-[var(--color-accent-muted)]"
                  : "bg-[var(--color-panel-muted)]"
              )}
            >
              <p
                className={cn(
                  "text-[13px] font-medium",
                  i === 0
                    ? "text-[var(--color-accent)]"
                    : "text-[var(--color-text-primary)]"
                )}
              >
                {action.title}
              </p>
              <p className="mt-0.5 text-[11.5px] leading-relaxed text-[var(--color-text-secondary)]">
                {action.prompt}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DemoFooter({
  step,
  onNext,
  onPrev,
  onReset,
}: {
  step: number;
  onNext: () => void;
  onPrev: () => void;
  onReset: () => void;
}) {
  const isFirst = step === 0;
  const isLast = step === 3;
  const isGenerating = step === 2;

  return (
    <div className="mt-6 flex items-center justify-between gap-3 border-t border-[var(--color-panel-muted)] pt-4">
      <span className="inline-flex items-center gap-1.5 text-[11.5px] text-[var(--color-text-tertiary)]">
        <Sparkles size={11} className="text-[var(--color-accent)]" />
        AI 根据场景生成
      </span>
      <div className="flex items-center gap-2">
        {!isFirst && !isGenerating && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onPrev}
            className="h-8 gap-1 rounded-[var(--radius-md)] px-3 text-[13px]"
          >
            <ArrowLeft size={14} strokeWidth={1.75} />
            上一步
          </Button>
        )}
        {isLast ? (
          <Button
            type="button"
            size="sm"
            onClick={onReset}
            className="h-8 gap-1 rounded-[var(--radius-md)] px-3 text-[13px]"
          >
            <RefreshCw size={13} strokeWidth={1.75} />
            重新开始
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            onClick={onNext}
            disabled={isGenerating}
            className="h-8 gap-1 rounded-[var(--radius-md)] px-3 text-[13px]"
          >
            {step === 1 ? "生成配置" : "下一步"}
            <ArrowRight size={14} strokeWidth={1.75} />
          </Button>
        )}
      </div>
    </div>
  );
}
