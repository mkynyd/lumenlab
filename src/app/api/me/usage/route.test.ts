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
    mockFindMany.mockResolvedValue([
      { model: "deepseek-v4-pro", creditsConsumed: 80, totalTokens: 800, inputCacheHitTokens: 0, inputCacheMissTokens: 0, outputTokens: 0 },
      { model: "minimax-m3", creditsConsumed: 20, totalTokens: 200, inputCacheHitTokens: 0, inputCacheMissTokens: 0, outputTokens: 0 },
    ]);
  });

  it("returns usage summary for authenticated user", async () => {
    const response = await GET(new Request("http://localhost/api/me/usage"));
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.tier).toBe("premium");
    expect(json.usage.currentCycleCredits).toBe(100);
    expect(json.usage.modelDistribution).toHaveLength(2);
    expect(json.quota.enforced).toBe(false);
  });

  it("returns 401 when not authenticated", async () => {
    mockSession.user = null as unknown as { id: string };
    const response = await GET(new Request("http://localhost/api/me/usage"));
    expect(response.status).toBe(401);
    mockSession.user = { id: "user-1" };
  });

  it("paginates recent records with cursor and returns nextCursor", async () => {
    const records = Array.from({ length: 21 }, (_, i) => ({
      id: `rec-${i}`,
      model: "deepseek-v4-pro",
      provider: "deepseek",
      creditsConsumed: 1,
      totalTokens: 10,
      inputCacheHitTokens: 0,
      inputCacheMissTokens: 0,
      outputTokens: 0,
      createdAt: new Date("2026-07-24T08:00:00Z"),
    }));
    mockFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(records);

    const response = await GET(
      new Request("http://localhost/api/me/usage?cursor=rec-x&limit=20"),
    );
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.usage.recentRecords).toHaveLength(20);
    expect(json.usage.nextCursor).toBe("rec-19");

    const recentQuery = mockFindMany.mock.calls[1][0];
    expect(recentQuery).toMatchObject({
      cursor: { id: "rec-x" },
      skip: 1,
      take: 21,
    });
  });

  it("returns null nextCursor when no more records and no cursor by default", async () => {
    const response = await GET(new Request("http://localhost/api/me/usage"));
    const json = await response.json();
    expect(json.usage.nextCursor).toBeNull();

    const recentQuery = mockFindMany.mock.calls[1][0];
    expect(recentQuery).toMatchObject({ take: 21 });
    expect(recentQuery.cursor).toBeUndefined();
    expect(recentQuery.skip).toBeUndefined();
  });

  it("clamps limit to a maximum of 100", async () => {
    const response = await GET(
      new Request("http://localhost/api/me/usage?limit=500"),
    );
    expect(response.status).toBe(200);
    const recentQuery = mockFindMany.mock.calls[1][0];
    expect(recentQuery.take).toBe(101);
  });
});
