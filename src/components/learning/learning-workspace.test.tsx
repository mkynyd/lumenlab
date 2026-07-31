import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const push = vi.fn()
const projectsState = vi.hoisted(() => ({
  result: {
    data: [] as Array<{
      id: string
      name: string
      description: string | null
      type: string
      updatedAt: string
      _count: { conversations: number; files: number }
    }>,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}))

vi.mock("@/lib/hooks/use-projects", () => ({
  useProjects: () => projectsState.result,
}))

vi.mock("@/components/learning/today-view", () => ({
  TodayView: () => <div data-testid="today-view" />,
}))

vi.mock("@/components/learning/learning-calendar", () => ({
  LearningCalendar: () => <div data-testid="learning-calendar" />,
}))

vi.mock("@/components/learning/learning-page-client", () => ({
  LearningPageClient: (props: {
    projectId: string
    projectName?: string | null
    embedded?: boolean
  }) => (
    <div
      data-testid="learning-client"
      data-project={props.projectId}
      data-project-name={props.projectName ?? ""}
      data-embedded={String(props.embedded)}
    />
  ),
}))

import { LearningWorkspace } from "@/components/learning/learning-workspace"

const project = {
  id: "project-1",
  name: "数据结构",
  description: null,
  type: "review",
  updatedAt: "2026-07-31T08:00:00.000Z",
  _count: { conversations: 2, files: 8 },
}

describe("LearningWorkspace", () => {
  beforeEach(() => {
    push.mockReset()
    projectsState.result = {
      data: [project],
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    }
  })

  it("renders learning as a first-class overview with calendar and project setup", () => {
    render(<LearningWorkspace rollout="default" />)

    expect(screen.getByRole("heading", { level: 1, name: "学习中心" })).toBeInTheDocument()
    expect(screen.getByTestId("today-view")).toBeInTheDocument()
    expect(screen.getByTestId("learning-calendar")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /数据结构/ })).toHaveAttribute(
      "href",
      "/learning?project=project-1"
    )
    expect(screen.getByText(/8 份资料/)).toBeInTheDocument()
  })

  it("opens the selected project's learning flow inside the workspace", () => {
    render(
      <LearningWorkspace
        initialProjectId="project-1"
        initialGoalId="goal-1"
        rollout="default"
      />
    )

    const client = screen.getByTestId("learning-client")
    expect(client).toHaveAttribute("data-project", "project-1")
    expect(client).toHaveAttribute("data-project-name", "数据结构")
    expect(client).toHaveAttribute("data-embedded", "true")
    expect(screen.getByRole("link", { name: "总览" })).toHaveAttribute(
      "href",
      "/learning"
    )
  })

  it("does not fall through to another project when the selected id is unavailable", () => {
    render(<LearningWorkspace initialProjectId="missing-project" />)

    expect(screen.getByText("没有找到这个学习项目")).toBeInTheDocument()
    expect(screen.queryByTestId("learning-client")).not.toBeInTheDocument()
  })
})
