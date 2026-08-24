import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  workspaceFindFirst: vi.fn(),
  fileAssetCreate: vi.fn(),
  uploadObjectBuffer: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({ prisma: { paperWorkspace: { findFirst: mocks.workspaceFindFirst }, fileAsset: { create: mocks.fileAssetCreate } } }));
vi.mock("@/lib/storage/object-storage", () => ({ uploadObjectBuffer: mocks.uploadObjectBuffer }));

import { POST } from "@/app/api/papers/workspaces/[id]/assets/route";

describe("POST /api/papers/workspaces/[id]/assets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.workspaceFindFirst.mockResolvedValue({ id: "paper-1", projectId: null });
    mocks.uploadObjectBuffer.mockResolvedValue({ provider: "local", key: "papers/user-1/paper-1/assets/asset-1/figure.png" });
    mocks.fileAssetCreate.mockResolvedValue({ id: "asset-1", originalName: "figure.png", mimeType: "image/png", size: 3 });
  });

  it("stores an owner-scoped image as a Paper FileAsset", async () => {
    const body = new FormData();
    body.append("file", new File([new Uint8Array([1, 2, 3])], "figure.png", { type: "image/png" }));
    const response = await POST({ formData: async () => body } as unknown as Request, { params: Promise.resolve({ id: "paper-1" }) });
    expect(response.status).toBe(201);
    expect(mocks.uploadObjectBuffer).toHaveBeenCalledWith(expect.objectContaining({ mimeType: "image/png", buffer: expect.any(Buffer) }));
    expect(mocks.fileAssetCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ projectId: null, category: "paper-asset", status: "uploaded" }) }));
  });

  it("rejects non-image uploads before touching object storage", async () => {
    const body = new FormData();
    body.append("file", new File(["not an image"], "notes.txt", { type: "text/plain" }));
    const response = await POST({ formData: async () => body } as unknown as Request, { params: Promise.resolve({ id: "paper-1" }) });
    expect(response.status).toBe(400);
    expect(mocks.uploadObjectBuffer).not.toHaveBeenCalled();
  });
});
