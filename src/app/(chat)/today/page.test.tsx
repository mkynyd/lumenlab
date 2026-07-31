import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/learning/today-view", () => ({
  TodayView: () => <div data-testid="today-view" />,
}));

import TodayPage from "@/app/(chat)/today/page";

describe("TodayPage", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fails closed when rollout is off", () => {
    vi.stubEnv("LEARNING_LOOP_ROLLOUT", "off");
    render(<TodayPage />);
    expect(screen.getByText("学习功能当前未开放")).toBeInTheDocument();
    expect(screen.queryByTestId("today-view")).not.toBeInTheDocument();
  });

  it("renders the today view in preview", () => {
    vi.stubEnv("LEARNING_LOOP_ROLLOUT", "preview");
    render(<TodayPage />);
    expect(screen.getByTestId("today-view")).toBeInTheDocument();
    expect(screen.getByText("学习功能预览版")).toBeInTheDocument();
  });

  it("renders the today view in default when durable execution is on", () => {
    vi.stubEnv("LEARNING_LOOP_ROLLOUT", "default");
    vi.stubEnv("AGENT_DURABLE_EXECUTION_ENABLED", "true");
    render(<TodayPage />);
    expect(screen.getByTestId("today-view")).toBeInTheDocument();
  });

  it("fails closed when default lacks durable execution", () => {
    vi.stubEnv("LEARNING_LOOP_ROLLOUT", "default");
    render(<TodayPage />);
    expect(screen.getByText("学习功能当前未开放")).toBeInTheDocument();
    expect(screen.queryByTestId("today-view")).not.toBeInTheDocument();
  });
});
