"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check } from "iconoir-react";
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
}

/** 滚动渐隐：清单顶部/底部有更多内容时显示渐变提示。 */
function useScrollFade<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    setEdges({
      start: scrollTop > 1,
      end: Math.ceil(scrollTop + clientHeight) < scrollHeight - 1,
    });
  }, []);

  useEffect(() => {
    update();
    const el = ref.current;
    const view = el?.ownerDocument.defaultView;
    if (!el || !view?.ResizeObserver) return;
    const observer = new view.ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [update]);

  return { ref, edges, onScroll: update };
}

function PlanMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-[var(--color-text-tertiary)]">{label}</p>
      <p className="mt-0.5 truncate text-sm text-[var(--color-text-primary)]" title={value}>{value}</p>
    </div>
  );
}

/**
 * Plan 审阅卡（awaiting_confirmation 首屏主角）：编号 Research Questions 清单 +
 * 底部确认条。布局参考 agent-plan-2，全部使用项目 token（无边框、扁平状态）。
 */
export function ResearchPlanReviewCard({
  plan,
  questions,
  showActions = false,
  confirming = false,
  revising = false,
  onConfirm,
  onRevise,
}: ResearchPlanReviewCardProps) {
  const { ref: listRef, edges: listEdges, onScroll: onListScroll } = useScrollFade<HTMLOListElement>();
  const [directive, setDirective] = useState("");

  return (
    <section aria-label="研究计划" className="bg-[var(--color-panel)] px-5 py-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-[var(--color-text-primary)]">研究计划</h2>
        <span className="shrink-0 text-xs tabular-nums text-[var(--color-text-tertiary)]">{questions.length} 个研究问题</span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <PlanMeta label="研究目标" value={plan.objective ?? plan.researchGoal} />
        <PlanMeta label="研究强度" value={plan.researchIntensity} />
        <PlanMeta label="目标时间" value={plan.targetTimeRange ?? plan.timeRange ?? "未限定"} />
        {plan.evidenceTimeRange ? <PlanMeta label="证据时间" value={plan.evidenceTimeRange} /> : null}
        <PlanMeta label="领域 Profile" value={plan.domainProfile?.name ?? "通用研究"} />
      </div>

      <div className="relative mt-5">
        <ol ref={listRef} onScroll={onListScroll} className="max-h-72 space-y-1 overflow-y-auto overscroll-contain">
          {questions.map((item, index) => (
            <li key={item.id} className="flex items-start gap-3 rounded-[var(--radius-md)] px-2 py-2 hover:bg-[var(--color-surface-hover)]">
              <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-panel-muted)] text-[11px] tabular-nums text-[var(--color-text-tertiary)]">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium leading-6 text-[var(--color-text-primary)]" title={item.title}>{item.title}</span>
                <span className="mt-0.5 block text-[11px] leading-5 text-[var(--color-text-tertiary)] line-clamp-2">{item.question}</span>
              </span>
              <span className="mt-1 shrink-0 rounded-full bg-[var(--color-interaction-selected)] px-2 py-0.5 text-[10px] text-[var(--color-accent)]">{item.priority} · {item.status}</span>
            </li>
          ))}
        </ol>
        <div aria-hidden="true" className={`pointer-events-none absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-[var(--color-panel)] to-transparent transition-opacity duration-200 ${listEdges.start ? "opacity-100" : "opacity-0"}`} />
        <div aria-hidden="true" className={`pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-[var(--color-panel)] to-transparent transition-opacity duration-200 ${listEdges.end ? "opacity-100" : "opacity-0"}`} />
      </div>

      <details className="mt-4">
        <summary className="cursor-pointer select-none text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]">计划详情（范围 / 来源策略 / 预期产出 / 完成标准）</summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
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
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Button type="button" variant="primary" size="sm" onClick={onConfirm} disabled={confirming}>
            <Check width={16} height={16} />确认计划并开始研究
          </Button>
          <input
            value={directive}
            onChange={(event) => setDirective(event.target.value)}
            placeholder="可选：先调整计划，例如缩小范围或补充来源"
            aria-label="计划调整意见"
            className="min-w-0 flex-1 rounded-[var(--radius-md)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none ring-1 ring-transparent placeholder:text-[var(--color-text-tertiary)] focus:ring-[var(--color-accent)]"
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              if (!directive.trim()) return;
              onRevise?.(directive.trim());
              setDirective("");
            }}
            disabled={revising || !directive.trim()}
          >
            提交调整
          </Button>
        </div>
      ) : null}
    </section>
  );
}
