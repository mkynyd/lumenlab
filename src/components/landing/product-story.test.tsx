import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProductStory } from "./product-story";

const motionPreference = vi.hoisted(() => ({ reduced: true }));
const gsapMocks = vi.hoisted(() => ({
  timeline: vi.fn(),
  timelineFromTo: vi.fn(),
  timelineTo: vi.fn(),
  refresh: vi.fn(),
  set: vi.fn(),
}));

vi.mock("./prefers-motion", () => ({
  usePrefersReducedMotion: () => motionPreference.reduced,
}));

vi.mock("gsap", () => ({
  gsap: (() => {
    const timeline = {
      fromTo: (...args: unknown[]) => {
        gsapMocks.timelineFromTo(...args);
        return timeline;
      },
      to: (...args: unknown[]) => {
        gsapMocks.timelineTo(...args);
        return timeline;
      },
    };
    gsapMocks.timeline.mockReturnValue(timeline);
    return {
      context: (setup: () => void) => {
        setup();
        return { revert: vi.fn() };
      },
      matchMedia: () => ({
        add: (_query: string, setup: () => void) => setup(),
        revert: vi.fn(),
      }),
      registerPlugin: vi.fn(),
      set: gsapMocks.set,
      timeline: gsapMocks.timeline,
    };
  })(),
}));

vi.mock("gsap/ScrollTrigger", () => ({
  ScrollTrigger: { refresh: gsapMocks.refresh },
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
  beforeEach(() => {
    vi.clearAllMocks();
  });

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
      screen.getAllByText("从 PDF 到可编辑的文档").length
    ).toBeGreaterThan(0);
  });

  it("uses a native sticky stage without ScrollTrigger pinning or snapping", async () => {
    motionPreference.reduced = false;
    const { container } = render(<ProductStory />);

    expect(container.querySelector("#features")).toHaveAttribute(
      "data-scroll-mode",
      "sticky-natural"
    );
    expect(container.querySelector("[data-story-stage]")).toHaveClass("sticky");
    expect(container.querySelectorAll("[data-story-panel]")).toHaveLength(3);
    expect(container.innerHTML).not.toContain("snap-mandatory");

    await waitFor(() => {
      expect(gsapMocks.timeline).toHaveBeenCalled();
    });
    const scrollTrigger =
      gsapMocks.timeline.mock.calls[0][0].scrollTrigger;
    expect(scrollTrigger).not.toHaveProperty("pin");
    expect(scrollTrigger).not.toHaveProperty("anticipatePin");
    expect(scrollTrigger).not.toHaveProperty("snap");
  });
});
