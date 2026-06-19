import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useCacheMetrics: vi.fn(),
}));

vi.mock("next-auth/react", () => ({
  signOut: vi.fn(),
  useSession: () => ({ data: { user: { email: "user@example.com" } } }),
}));

vi.mock("@/components/ui/theme-toggle", () => ({
  ThemeToggle: () => <div>Theme toggle</div>,
}));

vi.mock("@/lib/hooks/use-cache-metrics", () => ({
  useCacheMetrics: mocks.useCacheMetrics,
}));

import { SettingsPanel } from "@/components/settings/settings-panel";

describe("SettingsPanel token usage", () => {
  it("shows measured token totals and marks providers without data as unavailable", () => {
    mocks.useCacheMetrics.mockReturnValue({
      isPending: false,
      data: {
        tokenUsage: {
          totalTokens: 42_100,
          todayTokens: 6_100,
          requestCount: 5,
          unattributedTokens: 30_000,
          providers: {
            deepseek: { totalTokens: 12_100, requestCount: 2 },
            minimax: { totalTokens: 0, requestCount: 0 },
          },
        },
      },
    });

    render(<SettingsPanel compact />);

    expect(screen.getByText("Token 使用情况")).toBeInTheDocument();
    expect(screen.getByText("42.1K")).toBeInTheDocument();
    expect(screen.getByText("今日 6.1K")).toBeInTheDocument();
    expect(screen.getByText("12.1K")).toBeInTheDocument();
    expect(screen.getByText("--")).toBeInTheDocument();
    expect(screen.queryByText("近 7 天 Token 命中率")).not.toBeInTheDocument();
  });
});
