import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProductStory } from "./product-story";

const motionPreference = vi.hoisted(() => ({ reduced: true }));

vi.mock("./prefers-motion", () => ({
  usePrefersReducedMotion: () => motionPreference.reduced,
}));

vi.mock("gsap", () => ({
  gsap: {
    context: (setup: () => void) => {
      setup();
      return { revert: vi.fn() };
    },
    matchMedia: () => ({ add: vi.fn(), revert: vi.fn() }),
    registerPlugin: vi.fn(),
  },
}));

vi.mock("gsap/ScrollTrigger", () => ({
  ScrollTrigger: {},
}));

vi.mock("./demos/chat-demo", () => ({
  ChatDemo: () => <div data-testid="chat-demo" />,
}));

vi.mock("./demos/project-demo", () => ({
  ProjectDemo: () => <div data-testid="project-demo" />,
}));

vi.mock("./demos/conversion-demo", () => ({
  ConversionDemo: () => <div data-testid="conversion-demo" />,
}));

describe("ProductStory", () => {
  it("keeps every workflow chapter available when motion is reduced", () => {
    motionPreference.reduced = true;
    const { container } = render(<ProductStory />);

    expect(container.querySelector("#features")).toHaveAttribute(
      "aria-label",
      "LumenLab 产品工作流"
    );
    expect(
      screen.getAllByText("资料先归位，问题才有上下文").length
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText("回答引用你正在学的内容").length
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText("从 PDF 到可继续编辑的成果").length
    ).toBeGreaterThan(0);
  });

  it("hides and inerts inactive desktop scenes before GSAP initializes", () => {
    motionPreference.reduced = false;
    const { container } = render(<ProductStory />);

    const panels = Array.from(
      container.querySelectorAll<HTMLElement>("[data-story-panel]")
    );
    expect(panels).toHaveLength(3);
    expect(panels[0]).not.toHaveAttribute("aria-hidden", "true");
    expect(panels[0]).not.toHaveAttribute("inert");
    expect(panels[1]).toHaveClass("invisible", "opacity-0");
    expect(panels[1]).toHaveAttribute("aria-hidden", "true");
    expect(panels[1]).toHaveAttribute("inert");
    expect(panels[2]).toHaveClass("invisible", "opacity-0");
    expect(panels[2]).toHaveAttribute("inert");
  });
});
