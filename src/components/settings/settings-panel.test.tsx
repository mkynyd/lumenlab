import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useCacheMetrics: vi.fn()
}));

vi.mock("@/components/ui/theme-toggle", () => ({
  ThemeToggle: () => <div>Theme toggle</div>
}));

vi.mock("@/lib/hooks/use-cache-metrics", () => ({
  useCacheMetrics: mocks.useCacheMetrics
}));

import { SettingsPanel } from "@/components/settings/settings-panel";

describe("SettingsPanel token usage", () => {
  it("shows measured token totals and marks providers without data as unavailable", () => {
    mocks.useCacheMetrics.mockReturnValue({
      isPending: false,
      data: {
        cycle: {
          start: "2026-07-01T00:00:00.000Z",
          end: "2026-07-31T00:00:00.000Z"
        },
        tokenUsage: {
          totalTokens: 42_100,
          todayTokens: 6_100,
          requestCount: 5,
          unattributedTokens: 30_000,
          estimatedCostCny: 0.5,
          inputTokens: 30_000,
          outputTokens: 12_100,
          inputCacheHitTokens: 20_000,
          inputCacheMissTokens: 10_000,
          daily: [
            {
              date: "2026-07-01",
              totalTokens: 42_100,
              inputCacheHitTokens: 20_000,
              inputCacheMissTokens: 10_000,
              outputTokens: 12_100
            }
          ],
          providers: {
            deepseek: {
              totalTokens: 12_100,
              requestCount: 2,
              estimatedCostCny: 0.3
            },
            minimax: { totalTokens: 0, requestCount: 0, estimatedCostCny: 0 },
            bailian: { totalTokens: 0, requestCount: 0, estimatedCostCny: 0 }
          }
        },
        rag: {
          search: { hits: 1, misses: 1, hitRate: 0.5 },
          "file-select": { hits: 0, misses: 0, hitRate: 0 },
          "query-embed": { hits: 0, misses: 0, hitRate: 0 }
        }
      }
    });

    render(<SettingsPanel />);

    // Sidebar tabs should be visible
    expect(screen.getByText("服务访问")).toBeInTheDocument();
    expect(screen.getByText("用量统计")).toBeInTheDocument();
    expect(screen.getByText("个性化")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "服务访问" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(
      screen.getByRole("tabpanel", { name: "服务访问" })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "用量统计" }));

    expect(screen.getByRole("tab", { name: "用量统计" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(
      screen.getByRole("tabpanel", { name: "用量统计" })
    ).toBeInTheDocument();
    expect(mocks.useCacheMetrics).toHaveBeenCalledWith("cycle");
    expect(screen.getByText("42,100")).toBeInTheDocument();
    const usageBar = screen.getByRole("button", {
      name: "2026-07-01 共 42,100 tokens"
    });

    fireEvent.mouseEnter(usageBar);

    expect(screen.getByText("输入（命中缓存）")).toBeInTheDocument();
    expect(screen.getByText("输入（未命中缓存）")).toBeInTheDocument();
    expect(screen.getByText("输出")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "个性化" }));

    expect(screen.getByText("AI 画像")).toBeInTheDocument();
    expect(screen.queryByText("账户信息")).not.toBeInTheDocument();
    expect(screen.queryByText("退出登录")).not.toBeInTheDocument();
    expect(screen.queryByText("上传头像")).not.toBeInTheDocument();
  });
});
