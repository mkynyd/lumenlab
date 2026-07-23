import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

import UsagePage from "@/app/(chat)/usage/page";

const usageResponse = {
  tier: "premium",
  cycle: {
    start: "2026-07-01T00:00:00.000Z",
    end: "2026-07-31T23:59:59.999Z",
  },
  quota: {
    total: 10_000,
    used: 2_500,
    remaining: 7_500,
    enforced: true,
  },
  usage: {
    currentCycleCredits: 2_500,
    currentCycleTokens: 125_000,
    last24hCredits: 80,
    last7dCredits: 640,
    last5hCredits: 24,
    modelDistribution: [
      { model: "deepseek-v4-pro", credits: 2_000, tokens: 100_000 },
      { model: "minimax-m3", credits: 500, tokens: 25_000 },
    ],
    recentRecords: [
      {
        id: "usage-1",
        model: "deepseek-v4-pro",
        provider: "deepseek",
        totalTokens: 2_048,
        creditsConsumed: 42,
        createdAt: "2026-07-24T08:00:00.000Z",
      },
    ],
  },
};

describe("UsagePage", () => {
  beforeEach(() => {
    push.mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(usageResponse), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders quota, distribution, and recent requests as readable sections", async () => {
    render(<UsagePage />);

    expect(
      await screen.findByRole("heading", { name: "用量统计" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "账户用量概览" }),
    ).toHaveTextContent("7,500 / 10,000");
    expect(
      screen.getByRole("progressbar", { name: "已使用 25% 额度" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "模型分布" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("DeepSeek · 深度")).toHaveLength(2);
    expect(
      screen.getByRole("heading", { name: "最近请求" }),
    ).toBeInTheDocument();
    expect(screen.getByText("2,048")).toBeInTheDocument();
  });

  it("redirects an unauthenticated visitor to login", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 401 })),
    );

    render(<UsagePage />);

    await waitFor(() => expect(push).toHaveBeenCalledWith("/login"));
  });
});
