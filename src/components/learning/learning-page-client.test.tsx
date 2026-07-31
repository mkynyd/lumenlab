import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  fixtureGoal,
  fixtureKnowledgeMap,
  fixtureProgressResponse,
  fixtureReviewList,
  fixtureScopeConfirmed,
  fixtureScopeDraft,
  fixtureSession,
  fixtureWrongAnswerList,
} from "@/components/learning/__fixtures__/learning-fixtures";

const useLearningGoals = vi.fn();
const useCreateLearningGoal = vi.fn();
const useUpdateLearningGoalStatus = vi.fn();
const useLearningScope = vi.fn();
const useSaveScopeDraft = vi.fn();
const useConfirmScope = vi.fn();
const useKnowledgeMap = vi.fn();
const useGenerateKnowledgeMap = vi.fn();

vi.mock("@/lib/hooks/use-learning-goals", () => ({
  useLearningGoals: (...args: unknown[]) => useLearningGoals(...args),
  useCreateLearningGoal: (...args: unknown[]) => useCreateLearningGoal(...args),
  useUpdateLearningGoalStatus: (...args: unknown[]) =>
    useUpdateLearningGoalStatus(...args),
  useLearningScope: (...args: unknown[]) => useLearningScope(...args),
  useSaveScopeDraft: (...args: unknown[]) => useSaveScopeDraft(...args),
  useConfirmScope: (...args: unknown[]) => useConfirmScope(...args),
  useKnowledgeMap: (...args: unknown[]) => useKnowledgeMap(...args),
  useGenerateKnowledgeMap: (...args: unknown[]) =>
    useGenerateKnowledgeMap(...args),
}));

const useLearningSession = vi.fn();
const useCreateDiagnosticSession = vi.fn();
const useRecordHint = vi.fn();
const useRecordAnswerExposure = vi.fn();
const useSubmitAttempt = vi.fn();

vi.mock("@/lib/hooks/use-learning-session", () => ({
  useLearningSession: (...args: unknown[]) => useLearningSession(...args),
  useCreateDiagnosticSession: (...args: unknown[]) =>
    useCreateDiagnosticSession(...args),
  useRecordHint: (...args: unknown[]) => useRecordHint(...args),
  useRecordAnswerExposure: (...args: unknown[]) =>
    useRecordAnswerExposure(...args),
  useSubmitAttempt: (...args: unknown[]) => useSubmitAttempt(...args),
}));

const useLearningProgress = vi.fn();
const useWrongAnswers = vi.fn();
const useReviewQueue = vi.fn();
const useCreateReviewSession = vi.fn();

vi.mock("@/lib/hooks/use-learning-progress", () => ({
  useLearningProgress: (...args: unknown[]) => useLearningProgress(...args),
  useWrongAnswers: (...args: unknown[]) => useWrongAnswers(...args),
  useReviewQueue: (...args: unknown[]) => useReviewQueue(...args),
  useCreateReviewSession: (...args: unknown[]) =>
    useCreateReviewSession(...args),
}));

const useLearningHistory = vi.fn();
const useCorrectLearningErrorType = vi.fn();

vi.mock("@/lib/hooks/use-learning-history", () => ({
  useLearningHistory: (...args: unknown[]) => useLearningHistory(...args),
  useCorrectLearningErrorType: (...args: unknown[]) =>
    useCorrectLearningErrorType(...args),
}));

vi.mock("@/lib/hooks/use-project-files", () => ({
  useProjectFiles: () => ({ data: [], isLoading: false }),
}));

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

import { LearningPageClient } from "@/components/learning/learning-page-client";

function queryResult(data: unknown) {
  return { data, isLoading: false, isError: false, error: null, refetch: vi.fn() };
}

function loadingResult() {
  return { data: undefined, isLoading: true, isError: false, error: null, refetch: vi.fn() };
}

function mutationResult() {
  return {
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  };
}

function setupReadyState() {
  useLearningGoals.mockReturnValue(queryResult([fixtureGoal]));
  useLearningScope.mockReturnValue(queryResult(fixtureScopeConfirmed));
  useKnowledgeMap.mockReturnValue(queryResult(fixtureKnowledgeMap));
  useLearningProgress.mockReturnValue(queryResult(fixtureProgressResponse));
  useWrongAnswers.mockReturnValue(queryResult(fixtureWrongAnswerList.items));
  useReviewQueue.mockReturnValue(queryResult(fixtureReviewList.reviews));
  useLearningSession.mockReturnValue(queryResult(undefined));
  useLearningHistory.mockReturnValue(
    queryResult({
      goal: fixtureGoal,
      summary: {
        totalPoints: 0,
        weakPoints: 0,
        dueReviews: 0,
        attempts: 0,
        manualCorrections: 0,
      },
      points: [],
    })
  );
}

describe("LearningPageClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCreateLearningGoal.mockReturnValue(mutationResult());
    useUpdateLearningGoalStatus.mockReturnValue(mutationResult());
    useSaveScopeDraft.mockReturnValue(mutationResult());
    useConfirmScope.mockReturnValue(mutationResult());
    useGenerateKnowledgeMap.mockReturnValue(mutationResult());
    useCreateDiagnosticSession.mockReturnValue(mutationResult());
    useRecordHint.mockReturnValue(mutationResult());
    useRecordAnswerExposure.mockReturnValue(mutationResult());
    useSubmitAttempt.mockReturnValue(mutationResult());
    useCreateReviewSession.mockReturnValue(mutationResult());
    useCorrectLearningErrorType.mockReturnValue(mutationResult());
  });

  it("shows a loading state while goals load", () => {
    useLearningGoals.mockReturnValue(loadingResult());
    useLearningScope.mockReturnValue(queryResult(null));
    useKnowledgeMap.mockReturnValue(queryResult(null));
    render(<LearningPageClient projectId="project-1" />);
    expect(screen.getByText("加载中…")).toBeInTheDocument();
  });

  it("shows a retryable error instead of an empty form when queries fail", () => {
    useLearningGoals.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new TypeError("Failed to fetch"),
      refetch: vi.fn(),
    });
    useLearningScope.mockReturnValue(queryResult(null));
    useKnowledgeMap.mockReturnValue(queryResult(null));
    render(<LearningPageClient projectId="project-1" />);
    expect(screen.getByText("暂时无法读取学习数据")).toBeInTheDocument();
    expect(
      screen.getByText("网络异常或服务暂时不可用，请稍后重试。")
    ).toBeInTheDocument();
    expect(screen.queryByText(/Failed to fetch/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "开始学习" })
    ).not.toBeInTheDocument();
  });

  it("shows goal creation when there is no active goal", () => {
    useLearningGoals.mockReturnValue(queryResult([]));
    useLearningScope.mockReturnValue(queryResult(null));
    useKnowledgeMap.mockReturnValue(queryResult(null));
    render(<LearningPageClient projectId="project-1" />);
    expect(
      screen.getByRole("heading", { name: "开始学习" })
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/目标标题/)).toBeInTheDocument();
  });

  it("offers reactivation for historical goals", () => {
    const paused = { ...fixtureGoal, id: "goal-old", status: "paused" as const };
    useLearningGoals.mockReturnValue(queryResult([paused]));
    useLearningScope.mockReturnValue(queryResult(null));
    useKnowledgeMap.mockReturnValue(queryResult(null));
    render(<LearningPageClient projectId="project-1" />);
    expect(screen.getByText("历史目标")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "重新激活" })
    ).toBeInTheDocument();
  });

  it("gates on scope confirmation before map generation", () => {
    useLearningGoals.mockReturnValue(queryResult([fixtureGoal]));
    useLearningScope.mockReturnValue(queryResult(fixtureScopeDraft));
    useKnowledgeMap.mockReturnValue(queryResult(null));
    render(<LearningPageClient projectId="project-1" />);
    expect(
      screen.getByRole("heading", { name: "确认学习范围" })
    ).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  it("prompts map generation after scope is confirmed", () => {
    useLearningGoals.mockReturnValue(queryResult([fixtureGoal]));
    useLearningScope.mockReturnValue(queryResult(fixtureScopeConfirmed));
    useKnowledgeMap.mockReturnValue(queryResult(null));
    render(<LearningPageClient projectId="project-1" />);
    expect(
      screen.getByRole("button", { name: "生成知识点地图" })
    ).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  it("renders tabs with progress summary once the map exists", () => {
    setupReadyState();
    render(<LearningPageClient projectId="project-1" />);
    expect(
      screen.getByRole("tablist", { name: "学习视图" })
    ).toBeInTheDocument();
    expect(screen.getByText(/已掌握 3/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回项目" })).toHaveAttribute(
      "href",
      "/projects/project-1"
    );
  });

  it("shows the preview badge in preview rollout", () => {
    setupReadyState();
    render(<LearningPageClient projectId="project-1" rollout="preview" />);
    expect(screen.getByText("学习功能预览版")).toBeInTheDocument();
  });

  it("switches to wrong answers and review tabs", async () => {
    const user = userEvent.setup();
    setupReadyState();
    render(<LearningPageClient projectId="project-1" />);

    await user.click(screen.getByRole("tab", { name: "错题" }));
    expect(
      screen.getByText("二叉树的中序遍历结果是什么？")
    ).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "复习" }));
    expect(screen.getByText("二叉树遍历")).toBeInTheDocument();
  });

  it("opens the evidence-backed learning profile from the history tab", async () => {
    const user = userEvent.setup();
    setupReadyState();
    render(<LearningPageClient projectId="project-1" />);

    await user.click(screen.getByRole("tab", { name: "档案" }));

    expect(screen.getByRole("tab", { name: "档案" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(screen.getByText("还没有学习档案")).toBeInTheDocument();
  });

  it("starts a diagnostic session from the practice tab", async () => {
    const user = userEvent.setup();
    setupReadyState();
    const createDiagnostic = mutationResult();
    useCreateDiagnosticSession.mockReturnValue(createDiagnostic);
    render(<LearningPageClient projectId="project-1" />);

    await user.click(screen.getByRole("tab", { name: "练习" }));
    await user.click(
      screen.getByRole("button", { name: "开始诊断练习" })
    );
    expect(createDiagnostic.mutate).toHaveBeenCalledTimes(1);
  });

  it("resumes a session from initialSessionId", () => {
    setupReadyState();
    useLearningSession.mockReturnValue(queryResult(fixtureSession));
    render(
      <LearningPageClient projectId="project-1" initialSessionId="session-1" />
    );
    expect(screen.getByText("第 1 / 6 题")).toBeInTheDocument();
    expect(
      screen.getByText("二叉树的中序遍历结果是什么？")
    ).toBeInTheDocument();
  });

  it("opens the tab requested by a validated Today deep link", () => {
    setupReadyState();
    render(
      <LearningPageClient
        projectId="project-1"
        initialGoalId="goal-1"
        initialStep="review"
      />
    );
    expect(screen.getByRole("tab", { name: "复习" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(screen.getByText("二叉树遍历")).toBeInTheDocument();
  });

  it("opens the practice tab for a diagnostic deep link", () => {
    setupReadyState();
    render(
      <LearningPageClient
        projectId="project-1"
        initialGoalId="goal-1"
        initialStep="diagnostic"
      />
    );
    expect(screen.getByRole("tab", { name: "练习" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(
      screen.getByRole("button", { name: "开始诊断练习" })
    ).toBeInTheDocument();
  });

  it("moves between tabs with arrow keys using roving tabindex", async () => {
    const user = userEvent.setup();
    setupReadyState();
    render(<LearningPageClient projectId="project-1" />);

    const progressTab = screen.getByRole("tab", { name: "进度" });
    progressTab.focus();
    await user.keyboard("{ArrowRight}");

    const historyTab = screen.getByRole("tab", { name: "档案" });
    expect(historyTab).toHaveAttribute("aria-selected", "true");
    expect(historyTab).toHaveFocus();
    expect(historyTab).toHaveAttribute("tabindex", "0");
    expect(progressTab).toHaveAttribute("tabindex", "-1");

    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "复习" })).toHaveAttribute(
      "aria-selected",
      "true"
    );

    await user.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "进度" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
  });
});
