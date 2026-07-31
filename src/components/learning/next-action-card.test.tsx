import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  fixtureGoal,
  fixtureProgressSummary,
} from "@/components/learning/__fixtures__/learning-fixtures";
import type {
  LearningTodayGoalDto,
  TodayNextActionDto,
  TodayNextActionType,
} from "@/lib/hooks/use-learning-api";
import { NextActionCard } from "@/components/learning/next-action-card";

function makeEntry(
  type: TodayNextActionType,
  nextActionOverrides: Partial<TodayNextActionDto> = {}
): LearningTodayGoalDto {
  return {
    goal: fixtureGoal,
    project: { id: "project-1", name: "数据结构" },
    summary: fixtureProgressSummary,
    nextAction: {
      type,
      href: `/projects/project-1/learning?goal=goal-1&step=${type}`,
      ...nextActionOverrides,
    },
  };
}

describe("NextActionCard", () => {
  it.each([
    ["confirm_scope", "确认学习范围"],
    ["generate_map", "生成知识地图"],
    ["start_diagnostic", "开始诊断练习"],
    ["review", "到期复习"],
    ["continue_learning", "继续学习"],
  ] as const)(
    "renders the %s type with label %s, an icon, and the server href",
    (type, label) => {
      const entry = makeEntry(type);
      const { container } = render(<NextActionCard entry={entry} />);

      expect(screen.getByText(label)).toBeInTheDocument();
      expect(container.querySelector("svg")).not.toBeNull();
      expect(screen.getByRole("link")).toHaveAttribute(
        "href",
        entry.nextAction.href
      );
    }
  );

  it("passes the server href through unchanged", () => {
    const href = "/projects/project-1/learning?goal=goal-1&step=review";
    render(<NextActionCard entry={makeEntry("review", { href })} />);

    expect(screen.getByRole("link")).toHaveAttribute("href", href);
  });

  it("shows the due count in the review reason when dueCount is present", () => {
    render(
      <NextActionCard
        entry={makeEntry("review", { dueCount: 4, href: "/r" })}
      />
    );

    expect(
      screen.getByText("有 4 个知识点到期复习，先巩固已学内容")
    ).toBeInTheDocument();
  });

  it("falls back to a generic review reason when dueCount is missing", () => {
    render(<NextActionCard entry={makeEntry("review", { href: "/r" })} />);

    expect(
      screen.getByText("有知识点到期复习，先巩固已学内容")
    ).toBeInTheDocument();
  });

  it("derives the reason sentence for each non-review type", () => {
    const cases: Array<[TodayNextActionType, string]> = [
      ["start_diagnostic", "还没有做过诊断，先完成一轮诊断练习"],
      ["confirm_scope", "先确认学习范围，才能生成地图和练习"],
      ["generate_map", "范围已确认，下一步生成知识点地图"],
    ];
    for (const [type, reason] of cases) {
      const { unmount } = render(<NextActionCard entry={makeEntry(type)} />);
      expect(screen.getByText(reason)).toBeInTheDocument();
      unmount();
    }
  });

  it("formats nextReviewAt as a zh-CN date for continue_learning", () => {
    const nextReviewAt = "2026-08-14T08:00:00.000Z";
    const expected = new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(new Date(nextReviewAt));
    render(
      <NextActionCard entry={makeEntry("continue_learning", { nextReviewAt })} />
    );

    expect(
      screen.getByText(`保持节奏，下次复习在 ${expected}`)
    ).toBeInTheDocument();
  });

  it("uses the generic continue_learning reason without nextReviewAt", () => {
    render(
      <NextActionCard
        entry={makeEntry("continue_learning", { nextReviewAt: null })}
      />
    );

    expect(screen.getByText("保持节奏，继续学习")).toBeInTheDocument();
  });

  it("shows the project and goal source line", () => {
    render(<NextActionCard entry={makeEntry("review", { dueCount: 2 })} />);

    expect(
      screen.getByText("数据结构 · 数据结构期末复习")
    ).toBeInTheDocument();
  });
});
