"use client";

import { useState } from "react";
import { Check, EditPencil } from "iconoir-react";
import { Button } from "@/components/ui/button";

export interface ResearchPlanView {
  originalRequest?: string;
  objective?: string;
  intentType?: string;
  targetTimeRange?: string | null;
  evidenceTimeRange?: string | null;
  scopeInclusions?: string[];
  scopeExclusions?: string[];
  assumptions?: string[];
  evaluationDimensions?: string[];
  expectedOutput?: string;
  researchGoal: string;
  scope: string;
  timeRange: string | null;
  sourceStrategy: string[];
  completionCriteria: string[];
  expectedOutputs: string[];
  researchIntensity: string;
  domainProfile?: { name: string };
}

export interface ResearchPlanQuestionView {
  id: string;
  title: string;
  question: string;
  priority: string;
  status: string;
}

interface ResearchPlanReviewCardProps {
  plan: ResearchPlanView;
  questions: ResearchPlanQuestionView[];
  showActions?: boolean;
  confirming?: boolean;
  revising?: boolean;
  onConfirm?: () => void;
  onRevise?: (directive: string) => void;
  onCancel?: () => void;
}

function PlanMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-[var(--color-text-tertiary)]">{label}</p>
      <p className="mt-0.5 truncate text-sm text-[var(--color-text-primary)]" title={value}>{value}</p>
    </div>
  );
}

function questionDone(status: string) {
  return status === "resolved" || status === "completed";
}

/**
 * Plan 审阅卡（awaiting_confirmation 首屏主角）：标题 + 极简步骤清单 +
 * 底部「编辑 / 取消 / 开始」确认条，结构对齐深度研究参考 UI 的确认方案态。
 * 元数据与范围细节收进「计划详情」折叠区，不抢占首屏。
 */
export function ResearchPlanReviewCard({
  plan,
  questions,
  showActions = false,
  confirming = false,
  revising = false,
  onConfirm,
  onRevise,
  onCancel,
}: ResearchPlanReviewCardProps) {
  const [editing, setEditing] = useState(false);
  const [directive, setDirective] = useState("");

  return (
    <section aria-label="研究计划" className="rounded-[var(--radius-lg)] bg-[var(--color-panel-muted)] px-5 py-5 sm:px-7 sm:py-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="min-w-0 truncate text-lg font-semibold text-[var(--color-text-primary)]">{plan.objective ?? plan.researchGoal}</h2>
        <span className="shrink-0 text-xs tabular-nums text-[var(--color-text-tertiary)]">{questions.length} 个研究问题</span>
      </div>

      <ol className="mt-5 space-y-1">
        {questions.map((item, index) => {
          const done = questionDone(item.status);
          return (
            <li key={item.id} className="flex items-center gap-3 rounded-[var(--radius-md)] px-2 py-2.5" title={item.question}>
              {done ? (
                <span className="inline-flex size-[18px] shrink-0 items-center justify-center rounded-full bg-[var(--color-text-primary)] text-[var(--color-bg)]" aria-hidden="true">
                  <Check width={12} height={12} />
                </span>
              ) : (
                // 未完成的问题用序号而不是空圆圈：空圆圈会被误读成可点击的复选框。
                <span className="inline-flex size-[18px] shrink-0 items-center justify-center text-[11px] tabular-nums text-[var(--color-text-tertiary)]" aria-hidden="true">{index + 1}</span>
              )}
              <span className={`min-w-0 flex-1 truncate text-sm leading-6 ${done ? "text-[var(--color-text-primary)]" : "text-[var(--color-text-secondary)]"}`}>{item.title}</span>
            </li>
          );
        })}
      </ol>

      <details className="mt-4">
        <summary className="cursor-pointer select-none text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]">计划详情（范围 / 来源策略 / 预期产出 / 完成标准）</summary>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <PlanMeta label="研究强度" value={plan.researchIntensity} />
          <PlanMeta label="目标时间" value={plan.targetTimeRange ?? plan.timeRange ?? "未限定"} />
          {plan.evidenceTimeRange ? <PlanMeta label="证据时间" value={plan.evidenceTimeRange} /> : null}
          <PlanMeta label="领域 Profile" value={plan.domainProfile?.name ?? "通用研究"} />
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {plan.originalRequest ? <div className="min-w-0"><p className="text-[11px] text-[var(--color-text-tertiary)]">原始请求</p><p className="mt-1 text-sm leading-6 text-[var(--color-text-secondary)]">{plan.originalRequest}</p></div> : null}
          {plan.intentType ? <div className="min-w-0"><p className="text-[11px] text-[var(--color-text-tertiary)]">研究意图</p><p className="mt-1 text-sm leading-6 text-[var(--color-text-secondary)]">{plan.intentType}</p></div> : null}
          <div className="min-w-0">
            <p className="text-[11px] text-[var(--color-text-tertiary)]">研究范围</p>
            <p className="mt-1 text-sm leading-6 text-[var(--color-text-secondary)]">{plan.scope}</p>
          </div>
          {plan.scopeInclusions?.length ? <div className="min-w-0"><p className="text-[11px] text-[var(--color-text-tertiary)]">纳入范围</p><ul className="mt-1 space-y-1 text-sm leading-6 text-[var(--color-text-secondary)]">{plan.scopeInclusions.map((item) => <li key={item}>· {item}</li>)}</ul></div> : null}
          {plan.scopeExclusions?.length ? <div className="min-w-0"><p className="text-[11px] text-[var(--color-text-tertiary)]">排除范围</p><ul className="mt-1 space-y-1 text-sm leading-6 text-[var(--color-text-secondary)]">{plan.scopeExclusions.map((item) => <li key={item}>· {item}</li>)}</ul></div> : null}
          <div className="min-w-0">
            <p className="text-[11px] text-[var(--color-text-tertiary)]">来源策略</p>
            <ul className="mt-1 space-y-1 text-sm leading-6 text-[var(--color-text-secondary)]">{plan.sourceStrategy.map((item) => <li key={item}>· {item}</li>)}</ul>
          </div>
          <div className="min-w-0">
            <p className="text-[11px] text-[var(--color-text-tertiary)]">预期产出</p>
            {plan.expectedOutput ? <p className="mt-1 text-sm leading-6 text-[var(--color-text-secondary)]">{plan.expectedOutput}</p> : null}
            <ul className="mt-1 space-y-1 text-sm leading-6 text-[var(--color-text-secondary)]">{plan.expectedOutputs.map((item) => <li key={item}>· {item}</li>)}</ul>
          </div>
          <div className="min-w-0">
            <p className="text-[11px] text-[var(--color-text-tertiary)]">完成标准</p>
            <ul className="mt-1 space-y-1 text-sm leading-6 text-[var(--color-text-secondary)]">{plan.completionCriteria.map((item) => <li key={item}>· {item}</li>)}</ul>
          </div>
          {plan.evaluationDimensions?.length ? <div className="min-w-0"><p className="text-[11px] text-[var(--color-text-tertiary)]">评估维度</p><ul className="mt-1 space-y-1 text-sm leading-6 text-[var(--color-text-secondary)]">{plan.evaluationDimensions.map((item) => <li key={item}>· {item}</li>)}</ul></div> : null}
          {plan.assumptions?.length ? <div className="min-w-0"><p className="text-[11px] text-[var(--color-text-tertiary)]">默认假设</p><ul className="mt-1 space-y-1 text-sm leading-6 text-[var(--color-text-secondary)]">{plan.assumptions.map((item) => <li key={item}>· {item}</li>)}</ul></div> : null}
        </div>
      </details>

      {showActions ? (
        <div className="mt-6">
          {editing ? (
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (!directive.trim()) return;
                onRevise?.(directive.trim());
                setDirective("");
                setEditing(false);
              }}
            >
              <input
                value={directive}
                onChange={(event) => setDirective(event.target.value)}
                placeholder="先调整计划，例如缩小范围或补充来源"
                aria-label="计划调整意见"
                className="min-w-0 flex-1 rounded-[var(--radius-md)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none ring-1 ring-transparent placeholder:text-[var(--color-text-tertiary)] focus:ring-[var(--color-accent)]"
              />
              <Button type="submit" variant="secondary" size="sm" disabled={revising || !directive.trim()}>提交调整</Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>收起</Button>
            </form>
          ) : null}
          <div className="mt-2 flex items-center gap-2">
            <Button type="button" variant="secondary" size="sm" aria-expanded={editing} onClick={() => setEditing((open) => !open)}>
              <EditPencil width={14} height={14} />编辑
            </Button>
            <div className="ml-auto flex items-center gap-2">
              {onCancel ? (
                <Button type="button" variant="secondary" size="sm" onClick={onCancel}>取消</Button>
              ) : null}
              <Button type="button" variant="primary" size="sm" onClick={onConfirm} disabled={confirming}>
                <Check width={16} height={16} />开始研究
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
