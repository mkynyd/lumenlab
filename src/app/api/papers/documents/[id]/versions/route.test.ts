import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  listDocumentVersions: vi.fn(),
  restoreDocumentVersion: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/paper/service", () => ({ listDocumentVersions: mocks.listDocumentVersions, restoreDocumentVersion: mocks.restoreDocumentVersion }));

import { GET, POST } from "@/app/api/papers/documents/[id]/versions/route";

describe("Paper Document version recovery API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.listDocumentVersions.mockResolvedValue([{ id: "version-2", version: 2, status: "draft" }]);
    mocks.restoreDocumentVersion.mockResolvedValue({ id: "version-3", version: 3, status: "draft" });
  });

  it("lists only the owner-scoped document history", async () => {
    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ id: "document-1" }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ versions: [{ id: "version-2", version: 2, status: "draft" }] });
    expect(mocks.listDocumentVersions).toHaveBeenCalledWith("user-1", "document-1");
  });

  it("restores immutable content by appending a new version", async () => {
    const response = await POST(new Request("http://localhost", { method: "POST", body: JSON.stringify({ version: 2 }) }), { params: Promise.resolve({ id: "document-1" }) });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ version: { id: "version-3", version: 3, status: "draft" } });
    expect(mocks.restoreDocumentVersion).toHaveBeenCalledWith({ userId: "user-1", documentId: "document-1", version: 2 });
  });

  it("rejects malformed restore requests", async () => {
    const response = await POST(new Request("http://localhost", { method: "POST", body: JSON.stringify({ version: 0 }) }), { params: Promise.resolve({ id: "document-1" }) });
    expect(response.status).toBe(400);
    expect(mocks.restoreDocumentVersion).not.toHaveBeenCalled();
  });
});
