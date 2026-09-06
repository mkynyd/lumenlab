import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), findFirst: vi.fn(), readStoredObject: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({ prisma: { paperCompilation: { findFirst: mocks.findFirst } } }));
vi.mock("@/lib/storage/object-storage", () => ({ readStoredObject: mocks.readStoredObject }));

import { GET } from "./route";

describe("paper PDF preview", () => {
  const request = new Request("http://localhost/api/papers/compilations/compile-1/pdf");
  const context = { params: Promise.resolve({ id: "compile-1" }) };

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
  });

  it("serves private Qiniu PDF bytes without a cross-origin redirect", async () => {
    mocks.findFirst.mockResolvedValue({ status: "succeeded", pdfStorageProvider: "qiniu", pdfObjectKey: "papers/compile-1/main.pdf" });
    mocks.readStoredObject.mockResolvedValue(Buffer.from("%PDF-1.7\npreview"));
    const response = await GET(request, context);

    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "compile-1", documentVersion: { document: { userId: "user-1" } } },
    }));
    expect(mocks.readStoredObject).toHaveBeenCalledWith({ provider: "qiniu", key: "papers/compile-1/main.pdf" });
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).toBe("%PDF-1.7\npreview");
  });

  it("does not read storage when the compilation is not owned", async () => {
    mocks.findFirst.mockResolvedValue(null);
    const response = await GET(request, context);
    expect(response.status).toBe(404);
    expect(mocks.readStoredObject).not.toHaveBeenCalled();
  });
});
