import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LearningGoalDemo } from "./learning-goal-demo";
import { LearningMapDemo } from "./learning-map-demo";
import { LearningPracticeDemo } from "./learning-practice-demo";
import { LearningReviewDemo } from "./learning-review-demo";

describe("landing learning demos", () => {
  it("renders the knowledge map demo with real map rows", () => {
    render(<LearningMapDemo />);

    expect(screen.getByText("光电效应的实验规律")).toBeInTheDocument();
    expect(screen.getByText("爱因斯坦光电方程")).toBeInTheDocument();
    expect(screen.getByText("共 5 个知识点")).toBeInTheDocument();
  });

  it("renders the practice demo with question and post-submit feedback", () => {
    render(<LearningPracticeDemo />);

    expect(
      screen.getByText(/逸出光电子的最大初动能如何变化/)
    ).toBeInTheDocument();
    expect(screen.getByText("回答正确")).toBeInTheDocument();
    expect(screen.getByText("解析")).toBeInTheDocument();
  });

  it("renders the review demo with next action and due entries", () => {
    render(<LearningReviewDemo />);

    expect(screen.getAllByText("到期复习").length).toBeGreaterThan(0);
    expect(screen.getByText("截止频率与逸出功")).toBeInTheDocument();
    expect(screen.getByText(/错题 2 道待重做/)).toBeInTheDocument();
  });

  it("renders the goal demo and walks through the three steps", () => {
    render(<LearningGoalDemo />);

    expect(screen.getByDisplayValue("大学物理 · 光电效应专项复习")).toBeInTheDocument();
  });
});
