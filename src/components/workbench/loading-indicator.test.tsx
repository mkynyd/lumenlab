import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// jsdom 无 canvas 实现，mock 掉 thinking-orbs 只保留 props 透传
vi.mock("thinking-orbs", () => ({
  ThinkingOrb: (props: { state?: string; size?: number; speed?: number }) => (
    <canvas
      data-testid="thinking-orb"
      data-state={props.state}
      data-size={props.size}
      data-speed={props.speed}
    />
  ),
}));

import { LoadingIndicator } from "./loading-indicator";

describe("LoadingIndicator", () => {
  it("renders the spinner by default", () => {
    render(<LoadingIndicator label="加载中" />);

    expect(screen.getByRole("status")).toHaveAttribute("aria-label", "加载中");
    expect(screen.queryByTestId("thinking-orb")).not.toBeInTheDocument();
    expect(
      document.querySelector(".loading-indicator-spinner")
    ).toBeInTheDocument();
  });

  it("renders a 20px orb instead of the spinner when orb is set", () => {
    render(<LoadingIndicator orb="working" label="等待模型响应" size="sm" />);

    const orb = screen.getByTestId("thinking-orb");
    expect(orb).toHaveAttribute("data-state", "working");
    expect(orb).toHaveAttribute("data-size", "20");
    expect(
      document.querySelector(".loading-indicator-spinner")
    ).not.toBeInTheDocument();
  });

  it("uses the 64px orb in a column layout for lg size", () => {
    render(<LoadingIndicator orb="breathing" label="加载项目工作台" size="lg" />);

    expect(screen.getByTestId("thinking-orb")).toHaveAttribute(
      "data-size",
      "64"
    );
    expect(screen.getByRole("status").className).toContain("flex-col");
  });

  it("maps speed presets to orb speed multipliers", () => {
    render(<LoadingIndicator orb="working" speed="fast" />);

    expect(screen.getByTestId("thinking-orb")).toHaveAttribute(
      "data-speed",
      "1.3"
    );
  });
});
