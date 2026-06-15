import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const set = vi.fn();
const incr = vi.fn();

vi.mock("@/lib/redis", () => ({
  getRedis: () => ({ get, set, incr }),
}));

describe("export cache", () => {
  beforeEach(() => {
    get.mockReset();
    set.mockReset();
    incr.mockReset();
  });

  it("uses a deterministic content-addressed key", async () => {
    const { buildExportCacheKey } = await import("@/lib/cache/export-cache");
    expect(buildExportCacheKey("a", "pdf", "content")).toBe(
      buildExportCacheKey("a", "pdf", "content")
    );
    expect(buildExportCacheKey("a", "pdf", "content")).not.toBe(
      buildExportCacheKey("a", "pdf", "changed")
    );
  });

  it("round-trips buffers as base64 with a one-hour TTL", async () => {
    const { getCachedExport, setCachedExport } = await import(
      "@/lib/cache/export-cache"
    );
    set.mockResolvedValue("OK");
    await setCachedExport("key", Buffer.from("document"));
    expect(set).toHaveBeenCalledWith(
      "key",
      Buffer.from("document").toString("base64"),
      "EX",
      3600
    );

    get.mockResolvedValue(Buffer.from("document").toString("base64"));
    await expect(getCachedExport("key")).resolves.toEqual(
      Buffer.from("document")
    );
  });

  it("degrades to a cache miss when Redis fails", async () => {
    const { getCachedExport } = await import("@/lib/cache/export-cache");
    get.mockRejectedValue(new Error("offline"));
    await expect(getCachedExport("key")).resolves.toBeNull();
  });
});
