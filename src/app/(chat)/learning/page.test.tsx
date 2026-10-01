import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/components/study/workspace", () => ({ StudyWorkspace: () => <div>题集与学习日程</div> }));
import LearningPage from "./page";
describe("rebuilt learning entry", () => {
  it("opens the independent study workspace", () => {
    render(<LearningPage />);
    expect(screen.getByText("题集与学习日程")).toBeInTheDocument();
  });
});
