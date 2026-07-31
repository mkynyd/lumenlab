"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { NavArrowLeft } from "iconoir-react";

import type { LearningLoopRollout } from "@/lib/learning/feature-flags";
import type {
  LearningDeepLinkStep,
  LearningGoalDto,
} from "@/lib/hooks/use-learning-api";
import { createIdempotencyKey } from "@/lib/hooks/use-learning-api";
import {
  useGenerateKnowledgeMap,
  useKnowledgeMap,
  useLearningGoals,
  useLearningScope,
  useUpdateLearningGoalStatus,
} from "@/lib/hooks/use-learning-goals";
import {
  useCreateDiagnosticSession,
  useLearningSession,
} from "@/lib/hooks/use-learning-session";
import {
  useLearningProgress,
  useWrongAnswers,
} from "@/lib/hooks/use-learning-progress";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/learning/empty-state";
import { GoalCreateForm } from "@/components/learning/goal-create-form";
import { KnowledgeMapView } from "@/components/learning/knowledge-map-view";
import { LearningHistory } from "@/components/learning/learning-history";
import { friendlyLearningError } from "@/components/learning/learning-error";
import { LearningProgressSummary } from "@/components/learning/progress-summary";
import { PracticeSession } from "@/components/learning/practice-session";
import { ReviewQueue } from "@/components/learning/review-queue";
import { ScopePanel } from "@/components/learning/scope-panel";
import { WrongAnswerList } from "@/components/learning/wrong-answer-list";

type LearningTab =
  | "progress"
  | "history"
  | "map"
  | "practice"
  | "wrong"
  | "review";

const STEP_TAB: Record<LearningDeepLinkStep, LearningTab> = {
  scope: "progress",
  map: "map",
  diagnostic: "practice",
  review: "review",
};

const TABS: Array<{ id: LearningTab; label: string }> = [
  { id: "progress", label: "进度" },
  { id: "history", label: "档案" },
  { id: "map", label: "地图" },
  { id: "practice", label: "练习" },
  { id: "wrong", label: "错题" },
  { id: "review", label: "复习" },
];

export interface LearningPageClientProps {
  projectId: string;
  projectName?: string | null;
  initialGoalId?: string | null;
  initialStep?: LearningDeepLinkStep | null;
  initialSessionId?: string | null;
  rollout?: LearningLoopRollout;
  embedded?: boolean;
}

function HistoricalGoalRow({
  projectId,
  goal,
}: {
  projectId: string;
  goal: LearningGoalDto;
}) {
  const updateStatus = useUpdateLearningGoalStatus(projectId, goal.id);
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm text-[var(--color-text-primary)]">
          {goal.title}
        </p>
        <p className="text-xs text-[var(--color-text-tertiary)]">
          {goal.status === "completed"
            ? "已完成"
            : goal.status === "paused"
              ? "已暂停"
              : "已替换"}
        </p>
      </div>
      <Button
        type="button"
        variant="ghost"
        disabled={updateStatus.isPending}
        onClick={() => updateStatus.mutate({ status: "active" })}
      >
        重新激活
      </Button>
    </div>
  );
}

export function LearningPageClient({
  projectId,
  projectName = null,
  initialGoalId = null,
  initialStep = null,
  initialSessionId = null,
  rollout = "preview",
  embedded = false,
}: LearningPageClientProps) {
  const goalsQuery = useLearningGoals(projectId);
  const goals = goalsQuery.data ?? [];
  const activeGoal =
    goals.find(
      (goal) => goal.id === initialGoalId && goal.status === "active"
    ) ??
    goals.find((goal) => goal.status === "active") ??
    null;
  const historicalGoals = goals.filter((goal) => goal.status !== "active");
  const goalId = activeGoal?.id;

  const scopeQuery = useLearningScope(projectId, goalId);
  const mapQuery = useKnowledgeMap(projectId, goalId);
  const generateMap = useGenerateKnowledgeMap(projectId, goalId ?? "");
  const mapKeyRef = useRef<string | null>(null);
  const diagnosticKeyRef = useRef<string | null>(null);

  const scope = scopeQuery.data ?? null;
  const map = mapQuery.data ?? null;
  const scopeConfirmed = scope?.status === "confirmed";

  const [tab, setTab] = useState<LearningTab>(
    initialSessionId
      ? "practice"
      : initialStep
        ? STEP_TAB[initialStep]
        : "progress"
  );
  const [activeSessionId, setActiveSessionId] = useState<string | null>(
    initialSessionId
  );

  const sessionQuery = useLearningSession(
    projectId,
    activeSessionId ?? undefined
  );
  const createDiagnostic = useCreateDiagnosticSession(projectId, goalId ?? "");

  function handleGenerateMap() {
    if (!mapKeyRef.current) {
      mapKeyRef.current = createIdempotencyKey();
    }
    generateMap.mutate(
      { idempotencyKey: mapKeyRef.current },
      { onSuccess: () => (mapKeyRef.current = null) }
    );
  }

  function handleCreateDiagnostic() {
    if (!diagnosticKeyRef.current) {
      diagnosticKeyRef.current = createIdempotencyKey();
    }
    createDiagnostic.mutate(
      { idempotencyKey: diagnosticKeyRef.current },
      {
        onSuccess: (data) => {
          diagnosticKeyRef.current = null;
          setActiveSessionId(data.session.id);
        },
      }
    );
  }

  const topLevelError =
    goalsQuery.isError ||
    (goalId !== undefined && (scopeQuery.isError || mapQuery.isError));
  const topLevelErrorSource =
    goalsQuery.error ?? scopeQuery.error ?? mapQuery.error;

  const stage: "loading" | "error" | "goal" | "scope" | "map" | "ready" =
    goalsQuery.isLoading ||
    (goalId !== undefined && (scopeQuery.isLoading || mapQuery.isLoading))
      ? "loading"
      : topLevelError
        ? "error"
        : !activeGoal
          ? "goal"
          : !scopeConfirmed
            ? "scope"
            : !map
              ? "map"
              : "ready";

  function handleTabListKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const currentIndex = TABS.findIndex((item) => item.id === tab);
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % TABS.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + TABS.length) % TABS.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = TABS.length - 1;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    const nextTab = TABS[nextIndex].id;
    setTab(nextTab);
    document.getElementById(`learning-tab-${nextTab}`)?.focus();
  }

  return (
    <div className={cn(!embedded && "h-full overflow-y-auto")}>
      <div
        className={cn(
          "mx-auto w-full",
          embedded ? "max-w-none" : "max-w-3xl px-4 py-6 md:py-8"
        )}
      >
        {!embedded ? <header className="mb-6 flex items-center gap-3">
          <Link
            href={`/projects/${projectId}`}
            aria-label="返回项目"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] motion-reduce:transition-none"
          >
            <NavArrowLeft width={18} height={18} aria-hidden />
          </Link>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold text-[var(--color-text-primary)]">
              {activeGoal ? activeGoal.title : "学习"}
            </h1>
            {rollout === "preview" ? (
              <p className="text-xs text-[var(--color-text-tertiary)]">
                学习功能预览版
              </p>
            ) : null}
          </div>
        </header> : null}

        {stage === "loading" ? (
          <p
            role="status"
            className="py-12 text-center text-sm text-[var(--color-text-secondary)]"
          >
            加载中…
          </p>
        ) : null}

        {stage === "error" ? (
          <EmptyState
            title="暂时无法读取学习数据"
            description={friendlyLearningError(topLevelErrorSource)}
            action={
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  goalsQuery.refetch();
                  scopeQuery.refetch();
                  mapQuery.refetch();
                }}
              >
                重试
              </Button>
            }
          />
        ) : null}

        {stage === "goal" ? (
          <div className="space-y-8">
            <section aria-label="创建学习目标">
              <h2 className="mb-1 text-base font-medium text-[var(--color-text-primary)]">
                开始学习
              </h2>
              <p className="mb-4 text-sm text-[var(--color-text-secondary)]">
                为{projectName ? `「${projectName}」` : "这个项目"}设置学习目标，系统会基于所选项目资料生成知识点地图和诊断练习。
              </p>
              <GoalCreateForm projectId={projectId} />
            </section>
            {historicalGoals.length > 0 ? (
              <section aria-label="历史学习目标">
                <h2 className="mb-2 text-sm font-medium text-[var(--color-text-secondary)]">
                  历史目标
                </h2>
                <div className="divide-y divide-[var(--color-border-light)]">
                  {historicalGoals.map((goal) => (
                    <HistoricalGoalRow
                      key={goal.id}
                      projectId={projectId}
                      goal={goal}
                    />
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        ) : null}

        {stage === "scope" && goalId ? (
          <section aria-label="确认学习范围">
            <h2 className="mb-1 text-base font-medium text-[var(--color-text-primary)]">
              确认学习范围
            </h2>
            <p className="mb-4 text-sm text-[var(--color-text-secondary)]">
              确认范围后才会生成知识点地图和诊断练习。
            </p>
            <ScopePanel projectId={projectId} goalId={goalId} />
          </section>
        ) : null}

        {stage === "map" && goalId ? (
          <section aria-label="生成知识点地图">
            <KnowledgeMapView
              map={null}
              isGenerating={generateMap.isPending}
              generateDisabled={generateMap.isPending}
              onGenerate={handleGenerateMap}
            />
            {generateMap.isError ? (
              <p role="alert" className="mt-3 text-sm text-[var(--color-error)]">
                {friendlyLearningError(generateMap.error)}
              </p>
            ) : null}
          </section>
        ) : null}

        {stage === "ready" && goalId ? (
          <div>
            <div
              role="tablist"
              aria-label="学习视图"
              onKeyDown={handleTabListKeyDown}
              className="mb-6 flex w-full gap-0.5 overflow-x-auto rounded-[var(--radius-md)] bg-[var(--color-control)] p-0.5"
            >
              {TABS.map((item) => (
                <button
                  key={item.id}
                  id={`learning-tab-${item.id}`}
                  type="button"
                  role="tab"
                  aria-selected={tab === item.id}
                  aria-controls={`learning-panel-${item.id}`}
                  tabIndex={tab === item.id ? 0 : -1}
                  onClick={() => setTab(item.id)}
                  className={cn(
                    "flex-1 whitespace-nowrap rounded-[calc(var(--radius-md)-2px)] px-3 py-1.5 text-sm transition-colors motion-reduce:transition-none",
                    tab === item.id
                      ? "bg-[var(--color-surface)] font-medium text-[var(--color-text-primary)]"
                      : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {TABS.map((item) =>
              tab === item.id ? (
                <div
                  key={item.id}
                  id={`learning-panel-${item.id}`}
                  role="tabpanel"
                  aria-labelledby={`learning-tab-${item.id}`}
                  tabIndex={0}
                >
                  {item.id === "progress" ? (
                    <ProgressTab projectId={projectId} goalId={goalId} />
                  ) : null}

                  {item.id === "history" ? (
                    <LearningHistory projectId={projectId} goalId={goalId} />
                  ) : null}

                  {item.id === "map" ? (
                    <section aria-label="知识点地图">
                      <KnowledgeMapView map={map} />
                      <div className="mt-4">
                        <Button
                          type="button"
                          variant="ghost"
                          disabled={generateMap.isPending}
                          onClick={handleGenerateMap}
                        >
                          {generateMap.isPending ? "生成中…" : "重新生成地图"}
                        </Button>
                      </div>
                    </section>
                  ) : null}

                  {item.id === "practice" ? (
                    <PracticeTab
                      projectId={projectId}
                      goalId={goalId}
                      activeSessionId={activeSessionId}
                      sessionQuery={sessionQuery}
                      isCreating={createDiagnostic.isPending}
                      createError={
                        createDiagnostic.isError
                          ? friendlyLearningError(createDiagnostic.error)
                          : null
                      }
                      onStart={handleCreateDiagnostic}
                      onExitSession={() => setActiveSessionId(null)}
                    />
                  ) : null}

                  {item.id === "wrong" ? (
                    <WrongAnswersTab projectId={projectId} goalId={goalId} />
                  ) : null}

                  {item.id === "review" ? (
                    <ReviewQueue projectId={projectId} goalId={goalId} />
                  ) : null}
                </div>
              ) : null
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ProgressTab({
  projectId,
  goalId,
}: {
  projectId: string;
  goalId: string;
}) {
  const progressQuery = useLearningProgress(projectId, goalId);
  if (progressQuery.isLoading) {
    return (
      <p
        role="status"
        className="py-8 text-center text-sm text-[var(--color-text-secondary)]"
      >
        加载中…
      </p>
    );
  }
  if (progressQuery.isError || !progressQuery.data) {
    return (
      <EmptyState
        title="暂时无法读取学习进度"
        description={friendlyLearningError(progressQuery.error)}
        action={
          <Button
            type="button"
            variant="ghost"
            onClick={() => progressQuery.refetch()}
          >
            重试
          </Button>
        }
      />
    );
  }
  return <LearningProgressSummary summary={progressQuery.data.summary} />;
}

function WrongAnswersTab({
  projectId,
  goalId,
}: {
  projectId: string;
  goalId: string;
}) {
  const wrongQuery = useWrongAnswers(projectId, goalId);
  if (wrongQuery.isLoading) {
    return (
      <p
        role="status"
        className="py-8 text-center text-sm text-[var(--color-text-secondary)]"
      >
        加载中…
      </p>
    );
  }
  if (wrongQuery.isError || !wrongQuery.data) {
    return (
      <EmptyState
        title="暂时无法读取错题集"
        description={friendlyLearningError(wrongQuery.error)}
        action={
          <Button
            type="button"
            variant="ghost"
            onClick={() => wrongQuery.refetch()}
          >
            重试
          </Button>
        }
      />
    );
  }
  return <WrongAnswerList items={wrongQuery.data} />;
}

function PracticeTab({
  projectId,
  goalId,
  activeSessionId,
  sessionQuery,
  isCreating,
  createError,
  onStart,
  onExitSession,
}: {
  projectId: string;
  goalId: string;
  activeSessionId: string | null;
  sessionQuery: ReturnType<typeof useLearningSession>;
  isCreating: boolean;
  createError: string | null;
  onStart: () => void;
  onExitSession: () => void;
}) {
  if (activeSessionId) {
    if (sessionQuery.isLoading) {
      return (
        <p
          role="status"
          className="py-8 text-center text-sm text-[var(--color-text-secondary)]"
        >
          加载练习…
        </p>
      );
    }
    if (sessionQuery.isError || !sessionQuery.data) {
      return (
        <EmptyState
          title="暂时无法读取练习"
          description={friendlyLearningError(sessionQuery.error)}
          action={
            <div className="flex items-center justify-center gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => sessionQuery.refetch()}
              >
                重试
              </Button>
              <Button type="button" variant="ghost" onClick={onExitSession}>
                返回
              </Button>
            </div>
          }
        />
      );
    }
    return (
      <PracticeSession
        projectId={projectId}
        goalId={goalId}
        session={sessionQuery.data}
        onSessionUpdated={() => sessionQuery.refetch()}
        onExit={onExitSession}
      />
    );
  }

  return (
    <section aria-label="开始练习" className="py-6">
      <h2 className="mb-1 text-base font-medium text-[var(--color-text-primary)]">
        诊断练习
      </h2>
      <p className="mb-4 max-w-xl text-sm text-[var(--color-text-secondary)]">
        回答 5–10 道基于学习资料生成的题目，系统会据此定位你的薄弱知识点。先作答，再看判定和解析。
      </p>
      <Button type="button" disabled={isCreating} onClick={onStart}>
        {isCreating ? "创建中…" : "开始诊断练习"}
      </Button>
      {createError ? (
        <p role="alert" className="mt-3 text-sm text-[var(--color-error)]">
          {createError}
        </p>
      ) : null}
    </section>
  );
}
