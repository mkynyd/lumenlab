import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EmptyState } from "@/components/learning/empty-state";

describe("EmptyState", () => {
  it("renders the title", () => {
    render(<EmptyState title="还没有学习目标" />);

    expect(screen.getByText("还没有学习目标")).toBeInTheDocument();
  });

  it("renders the description when provided", () => {
    render(
      <EmptyState title="还没有学习目标" description="创建一个目标开始学习" />
    );

    expect(screen.getByText("创建一个目标开始学习")).toBeInTheDocument();
  });

  it("omits the description when not provided", () => {
    const { container } = render(<EmptyState title="还没有学习目标" />);

    expect(container.querySelectorAll("p")).toHaveLength(1);
  });

  it("renders the action node when provided", () => {
    render(
      <EmptyState
        title="还没有学习目标"
        action={<button type="button">新建目标</button>}
      />
    );

    expect(screen.getByRole("button", { name: "新建目标" })).toBeInTheDocument();
  });
});
