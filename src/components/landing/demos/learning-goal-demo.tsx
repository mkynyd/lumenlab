"use client";

import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, FileText, GraduationCap, RefreshCw, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { KnowledgeMapView } from "@/components/learning/knowledge-map-view";
import {
  MOCK_LEARNING_GOAL,
  MOCK_LEARNING_MAP,
  MOCK_LEARNING_SCOPE,
} from "@/lib/mock/landing-fixtures";
import { usePrefersReducedMotion } from "../prefers-motion";

/**
 * 首页「三步开始学习」演示。复刻学习上手路径：
 *  - 0 学习目标：目标标题 + 用途 + 目标日期 + 每天投入分钟（镜像真实 GoalCreateForm）
 *  - 1 学习范围：勾选纳入范围的资料，资料缺口单独标出（镜像真实 ScopePanel）
 *  - 2 知识点地图：复用真实 KnowledgeMapView 展示生成结果
 * 视觉与学习 workspace 一致：不接 API，所有数据来自 landing fixtures。
 */

const STEPS = [
  { id: "goal", label: "学习目标" },
  { id: "scope", label: "学习范围" },
  { id: "map", label: "知识点地图" },
];

interface LearningGoalDemoProps {
  className?: string;
}

export function LearningGoalDemo({ className }: LearningGoalDemoProps) {
  const [step, setStep] = useState(0);
  const reducedMotion = usePrefersReducedMotion();

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
            {step === 0 && <GoalStep />}
            {step === 1 && <ScopeStep />}
            {step === 2 && <MapStep />}
          </motion.div>
        </AnimatePresence>
      </div>

      <DemoFooter step={step} onNext={() => setStep((s) => Math.min(s + 1, 2))} onPrev={() => setStep((s) => Math.max(s - 1, 0))} onReset={() => setStep(0)} />
    </div>
  );
}

function DemoHeader() {
  return (
    <div className="mb-5 flex items-center gap-3">
      <span className="flex size-9 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-accent)] text-[var(--color-accent-contrast)]">
        <GraduationCap size={18} strokeWidth={1.75} />
      </span>
      <div className="min-w-0">
        <h3 className="text-[15px] font-semibold text-[var(--color-text-primary)]">
          新建学习目标
        </h3>
        <p className="text-[12px] text-[var(--color-text-secondary)]">
          确认范围后，从项目资料生成知识点地图
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
    <nav aria-label="学习上手步骤" className="mb-6">
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

function GoalStep() {
  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1.5 block text-[13px] font-medium text-[var(--color-text-primary)]">
          目标标题
        </label>
        <Input
          value={MOCK_LEARNING_GOAL.title}
          readOnly
          aria-readonly="true"
          className="h-9 text-[14px]"
        />
      </div>
      <div>
        <label className="mb-1.5 block text-[13px] font-medium text-[var(--color-text-primary)]">
          用途
        </label>
        <Textarea
          value={MOCK_LEARNING_GOAL.purpose}
          readOnly
          aria-readonly="true"
          className="h-20 resize-none text-[13px] leading-relaxed"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-[var(--color-text-primary)]">
            目标日期
          </label>
          <Input
            value={MOCK_LEARNING_GOAL.targetDate}
            readOnly
            aria-readonly="true"
            className="h-9 text-[14px]"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-[var(--color-text-primary)]">
            每天投入分钟
          </label>
          <Input
            value={MOCK_LEARNING_GOAL.dailyMinutes}
            readOnly
            aria-readonly="true"
            className="h-9 text-[14px]"
          />
        </div>
      </div>
    </div>
  );
}

function ScopeStep() {
  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-[13px] font-medium text-[var(--color-text-primary)]">
          纳入学习范围的资料
        </p>
        <ul className="space-y-1">
          {MOCK_LEARNING_SCOPE.files.map((file) => (
            <li
              key={file.id}
              className="flex min-h-9 items-center gap-2 rounded-lg bg-[var(--color-panel-muted)] px-3 text-[13px]"
            >
              <Check size={12} strokeWidth={2.5} className="shrink-0 text-[var(--color-accent)]" />
              <FileText size={12} className="shrink-0 text-[var(--color-text-tertiary)]" />
              <span className="flex-1 truncate text-[var(--color-text-primary)]">{file.name}</span>
              <span className="shrink-0 text-xs tabular-nums text-[var(--color-text-tertiary)]">
                {file.pages}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-[12px] leading-relaxed text-[var(--color-text-secondary)]">
        资料缺口：{MOCK_LEARNING_SCOPE.gaps.join("、")}。可以补充上传，也可以先确认范围。
      </p>
    </div>
  );
}

function MapStep() {
  return (
    <div className="space-y-3">
      <p className="flex items-center gap-1.5 text-[12px] text-[var(--color-text-secondary)]">
        <Sparkles size={11} className="text-[var(--color-accent)]" />
        已按确认的范围生成，每个知识点都带来源
      </p>
      <div className="max-h-64 overflow-y-auto pr-1">
        <KnowledgeMapView map={MOCK_LEARNING_MAP} />
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
  const isLast = step === 2;

  return (
    <div className="mt-6 flex items-center justify-between gap-3 border-t border-[var(--color-panel-muted)] pt-4">
      <span className="inline-flex items-center gap-1.5 text-[11.5px] text-[var(--color-text-tertiary)]">
        <Sparkles size={11} className="text-[var(--color-accent)]" />
        地图从项目资料生成
      </span>
      <div className="flex items-center gap-2">
        {!isFirst && (
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
            className="h-8 gap-1 rounded-[var(--radius-md)] px-3 text-[13px]"
          >
            {step === 1 ? "确认范围" : "下一步"}
            <ArrowRight size={14} strokeWidth={1.75} />
          </Button>
        )}
      </div>
    </div>
  );
}
