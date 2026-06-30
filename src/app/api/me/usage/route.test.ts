import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "./route";

const mockSession = vi.hoisted(() => ({ user: { id: "user-1" } }));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(() => Promise.resolve(mockSession)),
}));

const mockFindUnique = vi.fn();
const mockAggregate = vi.fn();
const mockGroupBy = vi.fn();
const mockFindMany = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => mockFindUnique(...args) },
    tokenUsage: {
      aggregate: (...args: unknown[]) => mockAggregate(...args),
      groupBy: (...args: unknown[]) => mockGroupBy(...args),
      findMany: (...args: unknown[]) => mockFindMany(...args),
    },
  },
}));

describe("GET /api/me/usage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUnique.mockResolvedValue({
      planTier: "premium",
      planCredits: 0,
      creditsUsed: 1234,
      cycleStartedAt: new Date("2026-06-01T00:00:00Z"),
    });
    mockAggregate.mockResolvedValue({ _sum: { creditsConsumed: 100, totalTokens: 1000 } });
    mockGroupBy.mockResolvedValue([
      { model: "deepseek-v4-pro", _sum: { creditsConsumed: 80, totalTokens: 800 } },
      { model: "minimax-m3", _sum: { creditsConsumed: 20, totalTokens: 200 } },
    ]);
    mockFindMany.mockResolvedValue([]);
  });

  it("returns usage summary for authenticated user", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.tier).toBe("premium");
    expect(json.usage.currentCycleCredits).toBe(100);
    expect(json.usage.modelDistribution).toHaveLength(2);
    expect(json.quota.enforced).toBe(false);
  });

  it("returns 401 when not authenticated", async () => {
    mockSession.user = null as unknown as { id: string };
    const response = await GET();
    expect(response.status).toBe(401);
    mockSession.user = { id: "user-1" };
  });
});
