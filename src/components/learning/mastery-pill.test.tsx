import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MasteryPill } from "@/components/learning/mastery-pill";

describe("MasteryPill", () => {
  it("renders the mastered state with a flat success fill", () => {
    render(<MasteryPill state="mastered" />);

    const pill = screen.getByText("已掌握");
    expect(pill).toHaveClass("bg-[var(--color-success-muted)]");
  });

  it("renders the learning state with a flat accent fill", () => {
    render(<MasteryPill state="learning" />);

    const pill = screen.getByText("学习中");
    expect(pill).toHaveClass("bg-[var(--color-accent-muted)]");
  });

  it("renders the new state with a neutral surface fill", () => {
    render(<MasteryPill state="new" />);

    const pill = screen.getByText("未开始");
    expect(pill).toHaveClass("bg-[var(--color-surface-hover)]");
  });
});
