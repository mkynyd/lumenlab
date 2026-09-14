import { describe, expect, it, vi } from "vitest";

const redirectMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

import UsagePage from "@/app/(chat)/usage/page";

describe("UsagePage", () => {
  it("redirects to the usage tab inside settings", () => {
    UsagePage();
    expect(redirectMock).toHaveBeenCalledWith("/chat#settings-usage");
  });
});
