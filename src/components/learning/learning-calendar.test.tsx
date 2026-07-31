import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  fixtureGoal,
  fixtureProgressSummary,
} from "@/components/learning/__fixtures__/learning-fixtures"
import type { LearningTodayResponse } from "@/lib/hooks/use-learning-api"

const todayState = vi.hoisted(() => ({
  result: {
    data: undefined as LearningTodayResponse | undefined,
    isPending: false,
  },
}))

vi.mock("@/lib/hooks/use-learning-today", () => ({
  useLearningToday: () => todayState.result,
}))

import {
  buildLearningSchedule,
  LearningCalendar,
} from "@/components/learning/learning-calendar"

const today: LearningTodayResponse = {
  asOf: "2026-07-31T08:00:00.000Z",
  goals: [
    {
      goal: fixtureGoal,
      project: { id: "project-1", name: "数据结构" },
      summary: { ...fixtureProgressSummary, due: 2 },
      nextAction: {
        type: "continue_learning",
        href: "/learning?project=project-1&goal=goal-1",
        nextReviewAt: "2026-08-03T08:00:00.000Z",
      },
    },
  ],
}

describe("LearningCalendar", () => {
  beforeEach(() => {
    todayState.result = { data: today, isPending: false }
  })

  it("builds due, next-review, and target-date events from persisted learning state", () => {
    const schedule = buildLearningSchedule(today)

    expect(schedule.map((item) => item.kind)).toEqual([
      "due",
      "review",
      "target",
    ])
    expect(schedule[0]).toMatchObject({
      projectId: "project-1",
      goalId: "goal-1",
      label: "2 个知识点待复习",
    })
  })

  it("renders the official calendar surface with text-equivalent events", () => {
    render(<LearningCalendar />)

    expect(screen.getByRole("heading", { name: "学习日历" })).toBeInTheDocument()
    expect(screen.getByText("到期复习 · 2 个知识点待复习")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /到期复习/ })).toHaveAttribute(
      "href",
      "/learning?project=project-1&goal=goal-1"
    )
    expect(screen.getByRole("grid")).toBeInTheDocument()
  })
})
