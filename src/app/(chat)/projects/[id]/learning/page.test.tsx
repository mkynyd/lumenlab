import { beforeEach, describe, expect, it, vi } from "vitest"

const redirect = vi.hoisted(() => vi.fn())

vi.mock("next/navigation", () => ({ redirect }))

import ProjectLearningPage from "@/app/(chat)/projects/[id]/learning/page"

async function renderPage(
  searchParams: {
    goal?: string | string[]
    step?: string | string[]
    session?: string | string[]
  } = {}
) {
  await ProjectLearningPage({
    params: Promise.resolve({ id: "project-1" }),
    searchParams: Promise.resolve(searchParams),
  })
}

describe("ProjectLearningPage compatibility redirect", () => {
  beforeEach(() => {
    redirect.mockReset()
  })

  it("moves a project learning link into the independent workspace", async () => {
    await renderPage({ goal: "goal-9", step: "review", session: "session-9" })

    expect(redirect).toHaveBeenCalledWith(
      "/learning?project=project-1&goal=goal-9&step=review&session=session-9"
    )
  })

  it("drops unknown and path-like deep-link values", async () => {
    await renderPage({ goal: "../goal", step: "answers", session: "../chat" })

    expect(redirect).toHaveBeenCalledWith("/learning?project=project-1")
  })

  it("accepts the diagnostic step vocabulary", async () => {
    await renderPage({ step: "diagnostic" })

    expect(redirect).toHaveBeenCalledWith(
      "/learning?project=project-1&step=diagnostic"
    )
  })
})
