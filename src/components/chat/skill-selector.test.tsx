import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SkillSelector } from "@/components/chat/skill-selector";

describe("SkillSelector", () => {
  it("shows the selected skill label in compact mode for a non-default skill", () => {
    render(<SkillSelector value="paper-reader" onChange={vi.fn()} compact />);

    const trigger = screen.getByRole("button", { name: "选择 Skill：论文阅读" });
    expect(trigger).toHaveTextContent("论文阅读");
    expect(trigger.querySelector("span")).toHaveClass("truncate");
  });

  it("stays icon-only in compact mode for the auto default", () => {
    render(<SkillSelector value="auto" onChange={vi.fn()} compact />);

    const trigger = screen.getByRole("button", { name: "选择 Skill：自动 Skill" });
    expect(trigger.textContent).toBe("");
  });

  it("stays icon-only in compact mode when skills are off", () => {
    render(<SkillSelector value="off" onChange={vi.fn()} compact />);

    const trigger = screen.getByRole("button", { name: "选择 Skill：关闭 Skill" });
    expect(trigger.textContent).toBe("");
  });

  it("keeps showing the label in the expanded (non-compact) layout", () => {
    render(
      <SkillSelector value="exam-coach" onChange={vi.fn()} compact={false} />
    );

    expect(
      screen.getByRole("button", { name: "选择 Skill：复习教练" })
    ).toHaveTextContent("复习教练");
  });

  it("falls back to the static accessible name when the value is unknown", () => {
    render(<SkillSelector value="custom-skill" onChange={vi.fn()} compact />);

    expect(
      screen.getByRole("button", { name: "选择 Skill" })
    ).toBeInTheDocument();
  });
});
