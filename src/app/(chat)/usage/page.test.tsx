import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const router = { push };

vi.mock("next/navigation", () => ({
  useRouter: () => router,
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
    nextCursor: null,
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

  it("renders stat windows shortest-first with units", async () => {
    render(<UsagePage />);

    expect(
      await screen.findByRole("heading", { name: "用量统计" }),
    ).toBeInTheDocument();

    const terms = screen
      .getAllByRole("term")
      .map((el) => el.textContent);
    expect(terms).toEqual([
      "周期 Credits",
      "周期 tokens",
      "最近 5 小时",
      "最近 24 小时",
      "最近 7 天",
    ]);

    const definitions = screen
      .getAllByRole("definition")
      .map((el) => el.textContent);
    expect(definitions).toEqual([
      "2,500 Credits",
      "125,000 tokens",
      "24 Credits",
      "80 Credits",
      "640 Credits",
    ]);
  });

  it("appends more recent records via 加载更多 and hides the button at the end", async () => {
    const user = userEvent.setup();
    const firstPage = {
      ...usageResponse,
      usage: { ...usageResponse.usage, nextCursor: "usage-1" },
    };
    const secondPage = {
      ...usageResponse,
      usage: {
        ...usageResponse.usage,
        recentRecords: [
          {
            id: "usage-2",
            model: "minimax-m3",
            provider: "minimax",
            totalTokens: 512,
            creditsConsumed: 8,
            createdAt: "2026-07-23T08:00:00.000Z",
          },
        ],
        nextCursor: null,
      },
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const body = String(input).includes("cursor=") ? secondPage : firstPage;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<UsagePage />);

    const loadMore = await screen.findByRole("button", { name: "加载更多" });
    await user.click(loadMore);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("cursor=usage-1&limit=20"),
    );
    expect(await screen.findByText("512")).toBeInTheDocument();
    expect(screen.getByText("2,048")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "加载更多" }),
    ).not.toBeInTheDocument();
  });
});
