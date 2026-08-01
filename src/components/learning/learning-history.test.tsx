/* eslint-disable @typescript-eslint/no-explicit-any */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { LearningHistory } from "@/components/learning/learning-history";
import type { LearningHistoryDto } from "@/lib/hooks/use-learning-api";
import {
  useCorrectLearningErrorType,
  useLearningHistory,
  useRegradeEvaluation,
  useResetLearningProfile,
  useReviseGoal,
} from "@/lib/hooks/use-learning-history";

vi.mock("@/lib/hooks/use-learning-history", () => ({
  useLearningHistory: vi.fn(),
  useCorrectLearningErrorType: vi.fn(),
  useRegradeEvaluation: vi.fn(),
  useResetLearningProfile: vi.fn(),
  useReviseGoal: vi.fn(),
}));

const mockUseLearningHistory = vi.mocked(useLearningHistory);
const mockUseCorrectLearningErrorType = vi.mocked(useCorrectLearningErrorType);
const mockUseRegradeEvaluation = vi.mocked(useRegradeEvaluation);
const mockUseResetLearningProfile = vi.mocked(useResetLearningProfile);
const mockUseReviseGoal = vi.mocked(useReviseGoal);

const correctMutate = vi.fn();
const regradeMutate = vi.fn();
const resetMutate = vi.fn();
const reviseMutate = vi.fn();

const fixtureHistory: LearningHistoryDto = {
  goal: {
    id: "goal-1",
    projectId: "project-1",
    title: "数据结构期中复习",
    purpose: null,
    targetDate: null,
    dailyMinutes: null,
    status: "active",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
  },
  summary: {
    totalPoints: 1,
    weakPoints: 1,
    dueReviews: 1,
    attempts: 3,
    manualCorrections: 1,
  },
  points: [
    {
      id: "progress-1",
      lineageId: "lineage-1",
      knowledgePointId: "kp-1",
      name: "二叉树遍历",
      masteryState: "learning",
      historicalMasteryState: "new",
      freshness: "current",
      nextReviewAt: "2026-08-05T00:00:00.000Z",
      reviewState: "due",
      policyVersion: "v1",
      evidenceAsOf: "2026-07-30T00:00:00.000Z",
      resetAt: null,
      sourceAnchors: [
        {
          id: "anchor-1",
          fileAssetId: "file-1",
          sourceFileName: "数据结构讲义.pdf",
          locator: { page: 3 },
        },
        {
          id: "anchor-2",
          fileAssetId: null,
          sourceFileName: "课堂笔记.md",
          locator: {},
        },
      ],
      evidence: [
        {
          attempt: {
            id: "attempt-1",
            answer: "opt-a",
            assistanceLevel: "hinted",
            spacingSeconds: 0,
            submittedAt: "2026-07-30T10:00:00.000Z",
          },
          session: { id: "session-1", mode: "diagnostic" },
          practiceItem: {
            id: "item-1",
            lineageId: "item-lineage-1",
            prompt: "二叉树的中序遍历结果是什么？",
            type: "single_choice",
            sourceAnchors: [
              {
                id: "anchor-3",
                fileAssetId: "file-1",
                sourceFileName: "数据结构讲义.pdf",
                locator: { page: 7 },
              },
            ],
          },
          evaluations: [
            {
              id: "eval-1",
              attemptId: "attempt-1",
              verdict: "incorrect",
              score: 0,
              confidence: 0.9,
              errorType: "knowledge_gap",
              reason: "selected_option_mismatch",
              policyVersion: "v1",
              supersedesEvaluationId: null,
              createdAt: "2026-07-30T10:00:01.000Z",
              corrections: [
                {
                  id: "corr-1",
                  evaluationId: "eval-1",
                  errorType: "misconception",
                  reason: "我把前序和中序记反了",
                  createdAt: "2026-07-30T11:00:00.000Z",
                },
              ],
            },
          ],
          activeEvaluationId: "eval-1",
          effectiveErrorType: {
            value: "misconception",
            source: "user_correction",
            sourceId: "corr-1",
          },
          resetBefore: false,
        },
      ],
    },
  ],
};

function mockQuery(overrides: Record<string, unknown>) {
  mockUseLearningHistory.mockReturnValue({
    data: undefined,
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  } as any);
}

beforeAll(() => {
  // jsdom lacks the pointer-capture / scroll APIs Radix Select relies on.
  const proto = Element.prototype as unknown as Record<string, unknown>;
  if (typeof proto.hasPointerCapture !== "function") {
    proto.hasPointerCapture = () => false;
    proto.setPointerCapture = () => undefined;
    proto.releasePointerCapture = () => undefined;
  }
  if (typeof proto.scrollIntoView !== "function") {
    proto.scrollIntoView = () => undefined;
  }
  if (typeof (globalThis as any).ResizeObserver !== "function") {
    (globalThis as any).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

describe("LearningHistory", () => {
  beforeEach(() => {
    correctMutate.mockReset();
    regradeMutate.mockReset();
    resetMutate.mockReset();
    reviseMutate.mockReset();
    mockUseCorrectLearningErrorType.mockReturnValue({
      mutate: correctMutate,
      isPending: false,
      isError: false,
    } as any);
    mockUseRegradeEvaluation.mockReturnValue({
      mutate: regradeMutate,
      isPending: false,
      isError: false,
    } as any);
    mockUseResetLearningProfile.mockReturnValue({
      mutate: resetMutate,
      isPending: false,
      isError: false,
    } as any);
    mockUseReviseGoal.mockReturnValue({
      mutate: reviseMutate,
      isPending: false,
      isError: false,
    } as any);
  });

  it("加载中显示可访问的加载状态", () => {
    mockQuery({ isPending: true });

    render(<LearningHistory projectId="project-1" goalId="goal-1" />);

    expect(screen.getByRole("status")).toHaveTextContent("加载中…");
  });

  it("加载失败可重试", async () => {
    const refetch = vi.fn();
    mockQuery({ isError: true, refetch });
    const user = userEvent.setup();

    render(<LearningHistory projectId="project-1" goalId="goal-1" />);

    expect(screen.getByText("学习档案加载失败")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("渲染摘要、知识点状态、证据、来源与人工修正说明", () => {
    mockQuery({ data: fixtureHistory });
    const { container } = render(
      <LearningHistory projectId="project-1" goalId="goal-1" />
    );

    // 档案摘要
    expect(screen.getByText("数据结构期中复习")).toBeInTheDocument();
    expect(
      screen.getByText(
        /知识点 1 · 薄弱点 1 · 到期复习 1 · 作答 3 次 · 人工修正 1 次/
      )
    ).toBeInTheDocument();

    // 知识点状态全部映射为中文
    expect(screen.getByText("二叉树遍历")).toBeInTheDocument();
    expect(screen.getByText("学习中")).toBeInTheDocument();
    expect(screen.getByText("待复习")).toBeInTheDocument();

    // 知识点来源：文件名 + 可读页码；locator 未知时只显示文件名
    expect(screen.getByText(/数据结构讲义\.pdf · 第 3 页/)).toBeInTheDocument();
    expect(screen.getByText(/课堂笔记\.md/)).toBeInTheDocument();

    // 证据内容
    expect(
      screen.getByText("二叉树的中序遍历结果是什么？")
    ).toBeInTheDocument();
    expect(screen.getByText(/诊断 · 回答错误/)).toBeInTheDocument();
    expect(screen.getByText("作答方式：看过提示")).toBeInTheDocument();
    expect(screen.getByText("有效判定：回答错误")).toBeInTheDocument();
    // reason code 复用 getEvaluationReasonLabel，不显示 raw code
    expect(
      screen.getByText("判定理由：所选答案与正确答案不一致")
    ).toBeInTheDocument();
    expect(container.innerHTML).not.toContain("selected_option_mismatch");

    // 证据来源
    expect(screen.getByText(/数据结构讲义\.pdf · 第 7 页/)).toBeInTheDocument();

    // 人工修正后的有效错因 + 原判定保留说明
    expect(screen.getByText(/有效错因：概念误解/)).toBeInTheDocument();
    expect(screen.getByText("人工修正")).toBeInTheDocument();
    expect(
      screen.getByText(/原判定错因：知识空缺（原判定记录仍保留）/)
    ).toBeInTheDocument();
    expect(
      screen.getByText("修正说明：我把前序和中序记反了")
    ).toBeInTheDocument();

    // 不泄漏敏感字段
    expect(container.innerHTML).not.toContain("answerCriteria");
    expect(container.innerHTML).not.toContain("generationMetadata");
    expect(container.innerHTML).not.toContain("rubric");
  });

  it("在有效判定上提交人工修正并携带幂等参数", async () => {
    mockQuery({ data: fixtureHistory });
    const user = userEvent.setup();

    render(<LearningHistory projectId="project-1" goalId="goal-1" />);

    await user.click(screen.getByRole("combobox", { name: "错因类型" }));
    await user.click(
      await screen.findByRole("option", { name: "方法选择" })
    );
    await user.click(screen.getByRole("button", { name: "保存修正" }));

    expect(correctMutate).toHaveBeenCalledTimes(1);
    const [variables] = correctMutate.mock.calls[0];
    expect(variables).toMatchObject({
      evaluationId: "eval-1",
      errorType: "method_choice",
    });
    expect(typeof variables.idempotencyKey).toBe("string");
  });

  it("仅在修正内容改变时轮换幂等参数", async () => {
    mockQuery({ data: fixtureHistory });
    const user = userEvent.setup();

    render(<LearningHistory projectId="project-1" goalId="goal-1" />);

    const select = screen.getByRole("combobox", { name: "错因类型" });
    await user.click(select);
    await user.click(await screen.findByRole("option", { name: "方法选择" }));
    await user.click(screen.getByRole("button", { name: "保存修正" }));
    const firstKey = correctMutate.mock.calls[0][0].idempotencyKey;

    await user.click(screen.getByRole("button", { name: "保存修正" }));
    const retryKey = correctMutate.mock.calls[1][0].idempotencyKey;

    await user.click(select);
    await user.click(await screen.findByRole("option", { name: "概念误解" }));
    await user.click(screen.getByRole("button", { name: "保存修正" }));
    const secondKey = correctMutate.mock.calls[2][0].idempotencyKey;

    expect(retryKey).toBe(firstKey);
    expect(firstKey).not.toBe(secondKey);
  });

  it("修正保存成功后给出可访问反馈", async () => {
    correctMutate.mockImplementation((_vars: unknown, opts: any) =>
      opts.onSuccess({ correction: { id: "corr-2" } })
    );
    mockQuery({ data: fixtureHistory });
    const user = userEvent.setup();

    render(<LearningHistory projectId="project-1" goalId="goal-1" />);

    await user.click(screen.getByRole("combobox", { name: "错因类型" }));
    await user.click(
      await screen.findByRole("option", { name: "概念误解" })
    );
    await user.click(screen.getByRole("button", { name: "保存修正" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "已保存修正。"
    );
  });

  it("修正保存失败时显示错误反馈", () => {
    mockUseCorrectLearningErrorType.mockReturnValue({
      mutate: correctMutate,
      isPending: false,
      isError: true,
    } as any);
    mockQuery({ data: fixtureHistory });

    render(<LearningHistory projectId="project-1" goalId="goal-1" />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "保存修正失败，请重试。"
    );
  });

  it("知识点暂无证据时显示说明", () => {
    mockQuery({
      data: {
        ...fixtureHistory,
        points: [
          {
            ...fixtureHistory.points[0],
            evidence: [],
          },
        ],
      },
    });

    render(<LearningHistory projectId="project-1" goalId="goal-1" />);

    expect(screen.getByText(/暂无作答证据/)).toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "错因类型" })
    ).not.toBeInTheDocument();
  });

  it("判定链没有唯一有效结果时停止展示结论和修正入口", () => {
    mockQuery({
      data: {
        ...fixtureHistory,
        points: [
          {
            ...fixtureHistory.points[0],
            evidence: [
              {
                ...fixtureHistory.points[0].evidence[0],
                activeEvaluationId: null,
                effectiveErrorType: null,
              },
            ],
          },
        ],
      },
    });

    render(<LearningHistory projectId="project-1" goalId="goal-1" />);

    expect(screen.getByText(/暂无有效判定/)).toBeInTheDocument();
    expect(
      screen.getByText("判定链暂不可用，本次作答不会影响当前档案。")
    ).toBeInTheDocument();
    expect(screen.queryByText(/有效错因：/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "错因类型" })
    ).not.toBeInTheDocument();
  });

  it("没有任何知识点时显示空档案状态", () => {
    mockQuery({ data: { ...fixtureHistory, points: [] } });

    render(<LearningHistory projectId="project-1" goalId="goal-1" />);

    expect(screen.getByText("还没有学习档案")).toBeInTheDocument();
  });

  it("重置前记录带标记且不提供修正与纠正入口", () => {
    mockQuery({
      data: {
        ...fixtureHistory,
        points: [
          {
            ...fixtureHistory.points[0],
            resetAt: "2026-08-01T08:00:00.000Z",
            evidence: [
              { ...fixtureHistory.points[0].evidence[0], resetBefore: true },
            ],
          },
        ],
      },
    });

    render(<LearningHistory projectId="project-1" goalId="goal-1" />);

    expect(screen.getByText("重置前记录")).toBeInTheDocument();
    expect(screen.getByText(/不再影响当前掌握度与推荐/)).toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "错因类型" })
    ).not.toBeInTheDocument();
    expect(screen.queryByText("纠正判定")).not.toBeInTheDocument();
  });

  it("纠正判定携带判定、错因与说明提交", async () => {
    mockQuery({ data: fixtureHistory });
    const user = userEvent.setup();

    render(<LearningHistory projectId="project-1" goalId="goal-1" />);

    await user.click(screen.getByText("纠正判定"));
    await user.click(
      screen.getByRole("combobox", { name: "纠正后的判定" })
    );
    await user.click(await screen.findByRole("option", { name: "回答正确" }));
    await user.click(
      screen.getByRole("combobox", { name: "纠正错因" })
    );
    await user.click(await screen.findByRole("option", { name: "概念误解" }));
    await user.type(
      screen.getByLabelText("纠正说明"),
      "标准答案应为正确"
    );
    await user.click(screen.getByRole("button", { name: "保存纠正" }));

    expect(regradeMutate).toHaveBeenCalledTimes(1);
    const [variables] = regradeMutate.mock.calls[0];
    expect(variables).toMatchObject({
      evaluationId: "eval-1",
      verdict: "correct",
      errorType: "misconception",
      reason: "标准答案应为正确",
    });
    expect(typeof variables.idempotencyKey).toBe("string");
  });

  it("重置知识点需要两次点击确认", async () => {
    mockQuery({ data: fixtureHistory });
    const user = userEvent.setup();

    render(<LearningHistory projectId="project-1" goalId="goal-1" />);

    await user.click(screen.getByText("重置该知识点"));
    expect(resetMutate).not.toHaveBeenCalled();

    await user.click(screen.getByText("再次点击确认重置该知识点"));
    expect(resetMutate).toHaveBeenCalledTimes(1);
    const [variables] = resetMutate.mock.calls[0];
    expect(variables).toMatchObject({
      scope: { kind: "point", goalId: "goal-1", lineageId: "lineage-1" },
    });
  });

  it("编辑学习目标时先提供说明再保存修订", async () => {
    mockQuery({ data: fixtureHistory });
    const user = userEvent.setup();

    render(<LearningHistory projectId="project-1" goalId="goal-1" />);

    await user.click(screen.getByText("编辑学习目标"));
    await user.clear(screen.getByLabelText("学习目标标题"));
    await user.type(screen.getByLabelText("学习目标标题"), "数据结构总复习");
    await user.type(
      screen.getByLabelText("修订说明"),
      "复习范围扩大"
    );
    await user.click(screen.getByRole("button", { name: "保存修订" }));

    expect(reviseMutate).toHaveBeenCalledTimes(1);
    const [variables] = reviseMutate.mock.calls[0];
    expect(variables).toMatchObject({
      title: "数据结构总复习",
      reason: "复习范围扩大",
    });
    expect(typeof variables.idempotencyKey).toBe("string");
  });
});
