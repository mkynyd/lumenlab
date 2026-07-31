import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fixtureProgressSummary } from "@/components/learning/__fixtures__/learning-fixtures";
import { LearningProgressSummary } from "@/components/learning/progress-summary";

describe("LearningProgressSummary", () => {
  it("renders the mastery counts line from the summary", () => {
    render(<LearningProgressSummary summary={fixtureProgressSummary} />);

    expect(
      screen.getByText("已掌握 3 · 学习中 7 · 未开始 10")
    ).toBeInTheDocument();
  });

  it("maps the summary onto the segmented bar aria-label", () => {
    render(<LearningProgressSummary summary={fixtureProgressSummary} />);

    expect(
      screen.getByRole("img", {
        name: "共 20 个知识点：3 已掌握、7 学习中、10 未开始，4 个待复习，2 个资料待更新、1 个资料不可用",
      })
    ).toBeInTheDocument();
  });

  it("renders the freshness hint when freshness counts are non-zero", () => {
    render(<LearningProgressSummary summary={fixtureProgressSummary} />);

    expect(screen.getByText("2 资料待更新")).toBeInTheDocument();
    expect(screen.getByText("1 资料不可用")).toBeInTheDocument();
  });

  it("omits the freshness hint when freshness counts are zero", () => {
    render(
      <LearningProgressSummary
        summary={{
          ...fixtureProgressSummary,
          needsRevalidation: 0,
          unsupported: 0,
        }}
      />
    );

    expect(
      screen.getByText("已掌握 3 · 学习中 7 · 未开始 10")
    ).toBeInTheDocument();
    expect(screen.queryByText(/资料待更新/)).not.toBeInTheDocument();
    expect(screen.queryByText(/资料不可用/)).not.toBeInTheDocument();
  });

  it("shows the empty bar state when the goal has no knowledge points", () => {
    render(
      <LearningProgressSummary
        summary={{
          total: 0,
          new: 0,
          learning: 0,
          mastered: 0,
          due: 0,
          needsRevalidation: 0,
          unsupported: 0,
        }}
      />
    );

    expect(
      screen.getByRole("img", { name: "还没有知识点" })
    ).toBeInTheDocument();
    expect(
      screen.getByText("已掌握 0 · 学习中 0 · 未开始 0")
    ).toBeInTheDocument();
  });
});
