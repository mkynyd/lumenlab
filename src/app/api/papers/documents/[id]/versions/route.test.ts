import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  listDocumentVersions: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/paper/service", () => ({ listDocumentVersions: mocks.listDocumentVersions }));

import * as route from "@/app/api/papers/documents/[id]/versions/route";

describe("Paper Document version history API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.listDocumentVersions.mockResolvedValue([{ id: "version-2", version: 2, status: "draft" }]);
  });

  it("lists only the owner-scoped document history", async () => {
    const response = await route.GET(new Request("http://localhost"), { params: Promise.resolve({ id: "document-1" }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ versions: [{ id: "version-2", version: 2, status: "draft" }] });
    expect(mocks.listDocumentVersions).toHaveBeenCalledWith("user-1", "document-1");
  });

  it("retires the restore write endpoint", () => {
    expect("POST" in route).toBe(false);
    expect("PUT" in route).toBe(false);
    expect("PATCH" in route).toBe(false);
    expect("DELETE" in route).toBe(false);
  });
});
