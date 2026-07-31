import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fixtureGoal,
  fixtureProgressSummary,
  fixtureToday,
} from "@/components/learning/__fixtures__/learning-fixtures";
import type { LearningTodayGoalDto } from "@/lib/hooks/use-learning-api";
import { TodayView } from "@/components/learning/today-view";

const hookState = vi.hoisted(() => ({
  result: {
    data: undefined as unknown,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
}));

vi.mock("@/lib/hooks/use-learning-today", () => ({
  useLearningToday: () => hookState.result,
}));

beforeEach(() => {
  hookState.result = {
    data: undefined,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  };
});

function makeGoalEntry(
  overrides: Partial<LearningTodayGoalDto> = {}
): LearningTodayGoalDto {
  return {
    goal: fixtureGoal,
    project: { id: "project-1", name: "数据结构" },
    summary: fixtureProgressSummary,
    nextAction: {
      type: "review",
      href: "/projects/project-1/learning?goal=goal-1&step=review",
      dueCount: 4,
    },
    ...overrides,
  };
}

describe("TodayView", () => {
  it("shows a loading indicator while the today payload loads", () => {
    hookState.result.isPending = true;
    render(<TodayView />);

    expect(screen.getByRole("status")).toHaveTextContent("加载中");
  });

  it("shows an error state and retries via refetch", async () => {
    const user = userEvent.setup();
    hookState.result.isError = true;
    render(<TodayView />);

    expect(screen.getByText("今日学习加载失败")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(hookState.result.refetch).toHaveBeenCalledTimes(1);
  });

  it("shows the empty state when there are no goals", () => {
    hookState.result.data = { asOf: "2026-07-31T08:00:00.000Z", goals: [] };
    render(<TodayView />);

    expect(screen.getByText("今天没有安排的学习任务")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看项目" })).toHaveAttribute(
      "href",
      "/projects"
    );
  });

  it("renders the single review goal as the main card on top", () => {
    hookState.result.data = fixtureToday;
    render(<TodayView />);

    expect(screen.getByText("到期复习")).toBeInTheDocument();
    expect(
      screen.getByText("有 4 个知识点到期复习，先巩固已学内容")
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "去复习" })).toHaveAttribute(
      "href",
      "/projects/project-1/learning?goal=goal-1&step=review"
    );
  });

  it("prefers a review action over confirm_scope when picking the main card", () => {
    hookState.result.data = {
      asOf: "2026-07-31T08:00:00.000Z",
      goals: [
        makeGoalEntry({
          goal: { ...fixtureGoal, id: "goal-scope", title: "范围待确认目标" },
          nextAction: {
            type: "confirm_scope",
            href: "/projects/project-1/learning?goal=goal-scope&step=scope",
          },
        }),
        makeGoalEntry({
          goal: { ...fixtureGoal, id: "goal-review", title: "到期复习目标" },
          nextAction: {
            type: "review",
            href: "/projects/project-1/learning?goal=goal-review&step=review",
            dueCount: 2,
          },
        }),
      ],
    };
    render(<TodayView />);

    expect(screen.getByText("到期复习")).toBeInTheDocument();
    expect(
      screen.getByText("有 2 个知识点到期复习，先巩固已学内容")
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "去复习" })).toHaveAttribute(
      "href",
      "/projects/project-1/learning?goal=goal-review&step=review"
    );
    expect(screen.queryByText("确认学习范围")).not.toBeInTheDocument();
  });

  it("falls back to the first goal when every next action is continue_learning", () => {
    hookState.result.data = {
      asOf: "2026-07-31T08:00:00.000Z",
      goals: [
        makeGoalEntry({
          nextAction: {
            type: "continue_learning",
            href: "/projects/project-1/learning?goal=goal-1",
            nextReviewAt: null,
          },
        }),
      ],
    };
    render(<TodayView />);

    expect(screen.getByText("继续学习")).toBeInTheDocument();
    expect(screen.getByText("保持节奏，继续学习")).toBeInTheDocument();
  });

  it("renders one row per goal with project name, summary, and enter link", () => {
    hookState.result.data = fixtureToday;
    render(<TodayView />);

    expect(screen.getByText("数据结构期末复习")).toBeInTheDocument();
    expect(screen.getByText("数据结构")).toBeInTheDocument();
    expect(
      screen.getByText("已掌握 3 · 学习中 7 · 未开始 10")
    ).toBeInTheDocument();

    const enterLink = screen.getByRole("link", { name: "进入学习" });
    expect(enterLink).toHaveAttribute(
      "href",
      "/projects/project-1/learning?goal=goal-1"
    );
  });

  it("does not render a page-level h1", () => {
    hookState.result.data = fixtureToday;
    render(<TodayView />);

    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
  });
});
