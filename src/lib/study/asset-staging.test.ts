import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ remove: vi.fn(), read: vi.fn(), create: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/storage/object-storage", () => ({ deleteStoredObject: mocks.remove, activeStorageProvider: () => "local" }));
vi.mock("@/lib/db", () => ({ prisma: { mistakeItem: { findFirst: mocks.read }, studyJob: { create: mocks.create, updateMany: mocks.update } } }));
import { beginAssetStaging, purgeStagedAssets } from "./asset-staging";
beforeEach(() => { vi.clearAllMocks(); mocks.read.mockResolvedValue(null); mocks.update.mockResolvedValue({ count: 1 }); });
describe("crash compensation", () => {
  it("durably records the destination before an object write and extends expiry", async () => {
    const stage = await beginAssetStaging('owner');
    await stage.reserve('item', 'study/selected/owner/item/0.png');
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: stage.id, status: 'staging' }, data: expect.objectContaining({ payload: { assets: [{ itemId: 'item', provider: 'local', key: 'study/selected/owner/item/0.png' }] } }) }));
  });
  it("deletes only uncommitted owned crops and protects committed items", async () => {
    mocks.read.mockResolvedValueOnce({ id: 'saved' }).mockResolvedValueOnce(null);
    await purgeStagedAssets('owner', { assets: ['saved', 'orphan'].map(itemId => ({ itemId, provider: 'local', key: `study/selected/owner/${itemId}/0.png` })) });
    expect(mocks.remove).toHaveBeenCalledTimes(1);
    expect(mocks.remove.mock.calls[0][0].key).toContain('/orphan/');
  });
  it("rejects foreign assets and refuses a staging row reclaimed by cleanup", async () => {
    await expect(purgeStagedAssets('owner', { assets: [{ itemId: 'item', provider: 'local', key: 'study/selected/other/item/0.png' }] })).rejects.toThrow();
    expect(mocks.remove).not.toHaveBeenCalled();
    const stage = await beginAssetStaging('owner'); mocks.update.mockResolvedValue({ count: 0 });
    await expect(stage.reserve('item', 'study/selected/owner/item/0.png')).rejects.toThrow('过期');
  });
});
