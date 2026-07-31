import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LearningProgressBar } from "@/components/learning/progress-bar";

const baseMastery = { new: 10, learning: 7, mastered: 3 };

describe("LearningProgressBar", () => {
  it("exposes role=img with a complete aria-label", () => {
    render(<LearningProgressBar mastery={baseMastery} />);

    expect(
      screen.getByRole("img", {
        name: "共 20 个知识点：3 已掌握、7 学习中、10 未开始",
      })
    ).toBeInTheDocument();
  });

  it("appends the due count to the aria-label and renders the due badge", () => {
    render(<LearningProgressBar mastery={baseMastery} dueCount={4} />);

    expect(
      screen.getByRole("img", {
        name: "共 20 个知识点：3 已掌握、7 学习中、10 未开始，4 个待复习",
      })
    ).toBeInTheDocument();
    expect(screen.getByText("4 待复习")).toBeInTheDocument();
  });

  it("appends freshness info to the aria-label and renders a neutral legend", () => {
    render(
      <LearningProgressBar
        mastery={baseMastery}
        dueCount={4}
        freshness={{ needsRevalidation: 2, unsupported: 1 }}
      />
    );

    expect(
      screen.getByRole("img", {
        name: "共 20 个知识点：3 已掌握、7 学习中、10 未开始，4 个待复习，2 个资料待更新、1 个资料不可用",
      })
    ).toBeInTheDocument();
    expect(screen.getByText("2 资料待更新")).toBeInTheDocument();
    expect(screen.getByText("1 资料不可用")).toBeInTheDocument();
  });

  it("omits the due badge and freshness legend when counts are zero", () => {
    render(
      <LearningProgressBar
        mastery={baseMastery}
        dueCount={0}
        freshness={{ needsRevalidation: 0, unsupported: 0 }}
      />
    );

    expect(screen.queryByText(/待复习/)).not.toBeInTheDocument();
    expect(screen.queryByText(/资料待更新/)).not.toBeInTheDocument();
    expect(screen.queryByText(/资料不可用/)).not.toBeInTheDocument();
  });

  it("never renders a percent sign in the DOM text", () => {
    const { container } = render(
      <LearningProgressBar
        mastery={baseMastery}
        dueCount={4}
        freshness={{ needsRevalidation: 2, unsupported: 1 }}
      />
    );

    expect(container.textContent).not.toContain("%");
  });

  it("sizes the three segments proportionally with reduced-motion-safe transitions", () => {
    const { container } = render(<LearningProgressBar mastery={baseMastery} />);

    const mastered = container.querySelector('[data-state="mastered"]');
    const learning = container.querySelector('[data-state="learning"]');
    const fresh = container.querySelector('[data-state="new"]');

    expect(mastered).toHaveStyle({ width: "15%" });
    expect(learning).toHaveStyle({ width: "35%" });
    expect(fresh).toHaveStyle({ width: "50%" });

    for (const segment of [mastered, learning, fresh]) {
      expect(segment).toHaveClass("transition-[width]");
      expect(segment).toHaveClass("motion-reduce:transition-none");
    }
  });

  it("honors an explicit totalPoints override for segment widths", () => {
    const { container } = render(
      <LearningProgressBar mastery={baseMastery} totalPoints={40} />
    );

    expect(container.querySelector('[data-state="mastered"]')).toHaveStyle({
      width: "7.5%",
    });
    expect(
      screen.getByRole("img", {
        name: "共 40 个知识点：3 已掌握、7 学习中、10 未开始",
      })
    ).toBeInTheDocument();
  });

  it("renders an empty track with a hint when there are no knowledge points", () => {
    const { container } = render(
      <LearningProgressBar mastery={{ new: 0, learning: 0, mastered: 0 }} totalPoints={0} />
    );

    expect(screen.getByText("还没有知识点")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "还没有知识点" })).toBeInTheDocument();
    expect(container.querySelector('[data-state="mastered"]')).toBeNull();
  });
});
