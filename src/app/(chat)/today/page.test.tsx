import { beforeEach, describe, expect, it, vi } from "vitest"

const redirect = vi.hoisted(() => vi.fn())

vi.mock("next/navigation", () => ({ redirect }))

import TodayPage from "@/app/(chat)/today/page"

describe("TodayPage", () => {
  beforeEach(() => {
    redirect.mockReset()
  })

  it("keeps the former Today URL as a compatibility redirect", () => {
    TodayPage()
    expect(redirect).toHaveBeenCalledWith("/learning")
  })
})
