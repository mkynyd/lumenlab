import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/learning/learning-page-client", () => ({
  LearningPageClient: (props: {
    projectId: string;
    initialGoalId?: string | null;
    initialStep?: string | null;
    initialSessionId?: string | null;
    rollout?: string;
  }) => (
    <div
      data-testid="learning-client"
      data-project-id={props.projectId}
      data-goal={props.initialGoalId ?? ""}
      data-step={props.initialStep ?? ""}
      data-session={props.initialSessionId ?? ""}
      data-rollout={props.rollout}
    />
  ),
}));

import ProjectLearningPage from "@/app/(chat)/projects/[id]/learning/page";

async function renderPage(searchParams: {
  goal?: string | string[];
  step?: string | string[];
  session?: string | string[];
} = {}) {
  const ui = await ProjectLearningPage({
    params: Promise.resolve({ id: "project-1" }),
    searchParams: Promise.resolve(searchParams),
  });
  return render(ui);
}

describe("ProjectLearningPage", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fails closed when rollout is off", async () => {
    vi.stubEnv("LEARNING_LOOP_ROLLOUT", "off");
    await renderPage();
    expect(screen.getByText("学习功能当前未开放")).toBeInTheDocument();
    expect(screen.queryByTestId("learning-client")).not.toBeInTheDocument();
  });

  it("passes project and session params to the client in preview", async () => {
    vi.stubEnv("LEARNING_LOOP_ROLLOUT", "preview");
    await renderPage({ session: "session-9" });
    const client = screen.getByTestId("learning-client");
    expect(client).toHaveAttribute("data-project-id", "project-1");
    expect(client).toHaveAttribute("data-session", "session-9");
    expect(client).toHaveAttribute("data-rollout", "preview");
  });

  it("defaults to no session when search params are empty", async () => {
    vi.stubEnv("LEARNING_LOOP_ROLLOUT", "preview");
    await renderPage();
    expect(screen.getByTestId("learning-client")).toHaveAttribute(
      "data-session",
      ""
    );
  });

  it("rejects path-like session ids", async () => {
    vi.stubEnv("LEARNING_LOOP_ROLLOUT", "preview");
    await renderPage({ session: "..%2F..%2Fchat" });
    expect(screen.getByTestId("learning-client")).toHaveAttribute(
      "data-session",
      ""
    );
  });

  it("passes validated Today deep-link params to the client", async () => {
    vi.stubEnv("LEARNING_LOOP_ROLLOUT", "preview");
    await renderPage({ goal: "goal-9", step: "review" });
    const client = screen.getByTestId("learning-client");
    expect(client).toHaveAttribute("data-goal", "goal-9");
    expect(client).toHaveAttribute("data-step", "review");
  });

  it("accepts the server diagnostic step vocabulary", async () => {
    vi.stubEnv("LEARNING_LOOP_ROLLOUT", "preview");
    await renderPage({ goal: "goal-9", step: "diagnostic" });
    expect(screen.getByTestId("learning-client")).toHaveAttribute(
      "data-step",
      "diagnostic"
    );
  });

  it("rejects action-type names that are not server step values", async () => {
    vi.stubEnv("LEARNING_LOOP_ROLLOUT", "preview");
    await renderPage({ goal: "goal-9", step: "start_diagnostic" });
    expect(screen.getByTestId("learning-client")).toHaveAttribute(
      "data-step",
      ""
    );
  });

  it("rejects unknown or path-like Today deep-link params", async () => {
    vi.stubEnv("LEARNING_LOOP_ROLLOUT", "preview");
    await renderPage({ goal: "../goal", step: "answers" });
    const client = screen.getByTestId("learning-client");
    expect(client).toHaveAttribute("data-goal", "");
    expect(client).toHaveAttribute("data-step", "");
  });
});
