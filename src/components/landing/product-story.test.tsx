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

vi.mock("./demos/learning-map-demo", () => ({
  LearningMapDemo: () => <div data-testid="learning-map-demo" />,
}));

vi.mock("./demos/learning-practice-demo", () => ({
  LearningPracticeDemo: () => <div data-testid="learning-practice-demo" />,
}));

vi.mock("./demos/learning-review-demo", () => ({
  LearningReviewDemo: () => <div data-testid="learning-review-demo" />,
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
      "LumenLab 学习闭环"
    );
    expect(screen.getAllByText("从资料生成地图").length).toBeGreaterThan(0);
    expect(screen.getAllByText("做几道题，找到薄弱点").length).toBeGreaterThan(0);
    expect(screen.getAllByText("按节奏复习到掌握").length).toBeGreaterThan(0);
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
