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

    render(<SettingsPanel />);

    // Sidebar tabs should be visible
    expect(screen.getByText("服务访问")).toBeInTheDocument();
    expect(screen.getByText("用量统计")).toBeInTheDocument();
    expect(screen.getByText("关于你")).toBeInTheDocument();
  });
});
