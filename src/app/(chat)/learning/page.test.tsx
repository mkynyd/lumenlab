import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/components/learning/learning-workspace", () => ({
  LearningWorkspace: (props: {
    initialProjectId?: string | null
    initialGoalId?: string | null
    initialStep?: string | null
    initialSessionId?: string | null
    rollout?: string
  }) => (
    <div
      data-testid="learning-workspace"
      data-project={props.initialProjectId ?? ""}
      data-goal={props.initialGoalId ?? ""}
      data-step={props.initialStep ?? ""}
      data-session={props.initialSessionId ?? ""}
      data-rollout={props.rollout}
    />
  ),
}))

import LearningPage from "@/app/(chat)/learning/page"

async function renderPage(
  searchParams: {
    project?: string | string[]
    goal?: string | string[]
    step?: string | string[]
    session?: string | string[]
  } = {}
) {
  const ui = await LearningPage({ searchParams: Promise.resolve(searchParams) })
  return render(ui)
}

describe("LearningPage", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("fails closed when the rollout is off", async () => {
    vi.stubEnv("LEARNING_LOOP_ROLLOUT", "off")
    await renderPage()

    expect(screen.getByText("学习功能当前未开放")).toBeInTheDocument()
    expect(screen.queryByTestId("learning-workspace")).not.toBeInTheDocument()
  })

  it("renders the independent overview in preview", async () => {
    vi.stubEnv("LEARNING_LOOP_ROLLOUT", "preview")
    await renderPage()

    const workspace = screen.getByTestId("learning-workspace")
    expect(workspace).toHaveAttribute("data-project", "")
    expect(workspace).toHaveAttribute("data-rollout", "preview")
  })

  it("passes validated project learning deep links", async () => {
    vi.stubEnv("LEARNING_LOOP_ROLLOUT", "preview")
    await renderPage({
      project: "project-1",
      goal: "goal-9",
      step: "diagnostic",
      session: "session-9",
    })

    const workspace = screen.getByTestId("learning-workspace")
    expect(workspace).toHaveAttribute("data-project", "project-1")
    expect(workspace).toHaveAttribute("data-goal", "goal-9")
    expect(workspace).toHaveAttribute("data-step", "diagnostic")
    expect(workspace).toHaveAttribute("data-session", "session-9")
  })

  it("drops dependent params when the project id is invalid", async () => {
    vi.stubEnv("LEARNING_LOOP_ROLLOUT", "preview")
    await renderPage({ project: "../project", goal: "goal-9", step: "review" })

    const workspace = screen.getByTestId("learning-workspace")
    expect(workspace).toHaveAttribute("data-project", "")
    expect(workspace).toHaveAttribute("data-goal", "")
    expect(workspace).toHaveAttribute("data-step", "")
  })
})
