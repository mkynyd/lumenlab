import { beforeEach, describe, expect, it, vi } from "vitest";
const remove = vi.hoisted(() => vi.fn());
vi.mock("@/lib/storage/object-storage", () => ({ deleteStoredObject: remove }));
import { purgeTemporaryAssets, selectedAssetKey, temporaryAssetKey } from "./asset-lifecycle";
beforeEach(() => { vi.clearAllMocks(); remove.mockResolvedValue(undefined); });
describe("temporary original cleanup boundary", () => {
  it("keeps selected assets outside the temporary prefix", () => {
    expect(selectedAssetKey("owner", "item", 0)).not.toContain("temporary");
    expect(temporaryAssetKey("owner", "job", 0)).toBe("study/temporary/owner/job/0.png");
  });
  it("refuses another user's, job's, or selected crop without deleting anything", async () => {
    for (const key of [temporaryAssetKey("other", "job", 0), temporaryAssetKey("owner", "other", 0), selectedAssetKey("owner", "item", 0), "study/temporary/owner/job/../selected.png"]) {
      await expect(purgeTemporaryAssets("owner", "job", [{ provider: "local", key }])).rejects.toThrow("拒绝");
    }
    expect(remove).not.toHaveBeenCalled();
  });
  it("deletes every page and surfaces failure to preserve the retry manifest", async () => {
    remove.mockRejectedValueOnce(new Error("storage unavailable"));
    await expect(purgeTemporaryAssets("owner", "job", [0, 1].map(page => ({ provider: "local" as const, key: temporaryAssetKey("owner", "job", page) })))).rejects.toThrow("重试");
    expect(remove).toHaveBeenCalledTimes(2);
  });
  it("rejects path traversal before generating keys", () => {
    expect(() => temporaryAssetKey("../owner", "job", 0)).toThrow();
    expect(() => selectedAssetKey("owner", "../item", 0)).toThrow();
  });
});
