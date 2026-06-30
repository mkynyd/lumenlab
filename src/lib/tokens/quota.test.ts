import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  addDays,
  getCycleEndDate,
  shouldResetCycle,
  isQuotaEnforced,
  getRemainingCredits,
  recordTokenUsage,
  checkQuotaForRequest,
} from "./quota";

const mockUser = {
  id: "user-1",
  planTier: "premium",
  planCredits: 1000,
  creditsUsed: 100,
  cycleStartedAt: new Date(),
};

const mockTokenUsageCreate = vi.fn();
const mockUserUpdate = vi.fn();
const mockUserFindUnique = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
      update: (...args: unknown[]) => mockUserUpdate(...args),
    },
    tokenUsage: {
      create: (...args: unknown[]) => mockTokenUsageCreate(...args),
    },
    $transaction: vi.fn(async (ops: unknown[]) => {
      return Promise.all(ops as Array<Promise<unknown>>);
    }),
  },
}));

describe("quota helpers", () => {
  it("addDays adds the correct number of days", () => {
    const date = new Date("2026-01-01T00:00:00Z");
    expect(addDays(date, 30).toISOString()).toBe("2026-01-31T00:00:00.000Z");
  });

  it("computes cycle end date", () => {
    const start = new Date("2026-01-01T00:00:00Z");
    expect(getCycleEndDate(start).toISOString()).toBe("2026-01-31T00:00:00.000Z");
  });

  it("detects when cycle should reset", () => {
    const past = addDays(new Date(), -31);
    expect(shouldResetCycle(past)).toBe(true);
    expect(shouldResetCycle(new Date())).toBe(false);
  });

  it("detects quota enforcement", () => {
    expect(isQuotaEnforced(0)).toBe(false);
    expect(isQuotaEnforced(-1)).toBe(false);
    expect(isQuotaEnforced(100)).toBe(true);
  });

  it("computes remaining credits", () => {
    expect(getRemainingCredits({ planCredits: 1000, creditsUsed: 100 })).toBe(900);
    expect(getRemainingCredits({ planCredits: 0, creditsUsed: 100 })).toBeNull();
  });
});

describe("recordTokenUsage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserFindUnique.mockResolvedValue(mockUser);
    mockTokenUsageCreate.mockResolvedValue({ id: "usage-1" });
    mockUserUpdate.mockResolvedValue({ ...mockUser, creditsUsed: 103 });
  });

  it("creates TokenUsage and increments user credits", async () => {
    await recordTokenUsage({
      userId: "user-1",
      conversationId: "conv-1",
      messageId: "msg-1",
      model: "deepseek-v4-flash",
      provider: "deepseek",
      inputCacheHitTokens: 0,
      inputCacheMissTokens: 1000,
      outputTokens: 1000,
      totalTokens: 2000,
    });

    expect(mockTokenUsageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user-1",
          creditsConsumed: expect.any(Number),
        }),
      })
    );
    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user-1" },
        data: expect.objectContaining({ creditsUsed: expect.any(Number) }),
      })
    );
  });

  it("resets cycle when expired", async () => {
    mockUserFindUnique.mockResolvedValue({
      ...mockUser,
      cycleStartedAt: addDays(new Date(), -31),
    });

    await recordTokenUsage({
      userId: "user-1",
      model: "deepseek-v4-flash",
      provider: "deepseek",
      inputCacheHitTokens: 0,
      inputCacheMissTokens: 1000,
      outputTokens: 0,
      totalTokens: 1000,
    });

    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ creditsUsed: 1 }),
      })
    );
  });
});

describe("checkQuotaForRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows request when quota is not enforced", async () => {
    mockUserFindUnique.mockResolvedValue({ ...mockUser, planCredits: 0 });
    const result = await checkQuotaForRequest("user-1", 100);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBeNull();
  });

  it("blocks request when remaining credits insufficient", async () => {
    mockUserFindUnique.mockResolvedValue(mockUser);
    const result = await checkQuotaForRequest("user-1", 1000);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(900);
  });

  it("allows request when enough credits remain", async () => {
    mockUserFindUnique.mockResolvedValue(mockUser);
    const result = await checkQuotaForRequest("user-1", 100);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(900);
  });
});
