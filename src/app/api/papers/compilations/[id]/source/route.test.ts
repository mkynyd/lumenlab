import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  compilationFindFirst: vi.fn(),
  createSignedDownloadUrl: vi.fn(),
  readStoredObject: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({ prisma: { paperCompilation: { findFirst: mocks.compilationFindFirst } } }));
vi.mock("@/lib/storage/object-storage", () => ({
  createSignedDownloadUrl: mocks.createSignedDownloadUrl,
  readStoredObject: mocks.readStoredObject,
}));

import { GET } from "@/app/api/papers/compilations/[id]/source/route";

describe("GET /api/papers/compilations/[id]/source", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.compilationFindFirst.mockResolvedValue({ sourceStorageProvider: "qiniu", sourceObjectKey: "papers/user-1/compile-1/source.zip" });
    mocks.createSignedDownloadUrl.mockReturnValue("https://cdn.example.com/source");
  });

  it("checks ownership and returns a short-lived signed project download", async () => {
    const response = await GET(new Request("http://localhost/api/papers/compilations/compile-1/source"), { params: Promise.resolve({ id: "compile-1" }) });

    expect(response.status).toBe(307);
    expect(mocks.compilationFindFirst).toHaveBeenCalledWith({
      where: { id: "compile-1", documentVersion: { document: { userId: "user-1" } } },
      select: { sourceStorageProvider: true, sourceObjectKey: true },
    });
    expect(mocks.createSignedDownloadUrl).toHaveBeenCalledWith({
      provider: "qiniu",
      key: "papers/user-1/compile-1/source.zip",
      filename: "paper-latex-project.zip",
      expiresInSeconds: 600,
    });
    expect(response.headers.get("location")).toBe("https://cdn.example.com/source");
  });

  it("streams a local project with download headers", async () => {
    mocks.compilationFindFirst.mockResolvedValue({ sourceStorageProvider: "local", sourceObjectKey: "papers/user-1/compile-1/source.zip" });
    mocks.readStoredObject.mockResolvedValue(Buffer.from("zip-bytes"));

    const response = await GET(new Request("http://localhost/api/papers/compilations/compile-1/source"), { params: Promise.resolve({ id: "compile-1" }) });

    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe("zip-bytes");
    expect(response.headers.get("content-type")).toContain("application/zip");
    expect(response.headers.get("content-disposition")).toContain("paper-latex-project.zip");
  });
});
