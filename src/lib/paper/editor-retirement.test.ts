import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/paper/service", () => ({ listPaperWorkspaces: vi.fn(), getPaperWorkspace: vi.fn(), getLatestPaperCompilation: vi.fn(), listDocumentVersions: vi.fn(), getPaperImport: vi.fn() }));
vi.mock("@/lib/storage/object-storage", () => ({ readStoredObject: vi.fn(), uploadObjectBuffer: vi.fn() }));

/**
 * 11E：交互式论文编辑退场后，旧写入口不得再从网络调用。
 * 只读 GET 保留；任何写方法一旦被重新加回都会让本测试失败。
 */
const READ_ONLY_ROUTES = [
  "@/app/api/papers/workspaces/route",
  "@/app/api/papers/workspaces/[id]/document/route",
  "@/app/api/papers/documents/[id]/compile/route",
  "@/app/api/papers/documents/[id]/versions/route",
  "@/app/api/papers/imports/[id]/route",
] as const;

const REMOVED_ROUTES = [
  "@/app/api/papers/workspaces/[id]/assets/route",
  "@/app/api/papers/workspaces/[id]/references/route",
  "@/app/api/papers/documents/[id]/assistant/route",
  "@/app/api/papers/documents/[id]/patches/route",
  "@/app/api/papers/documents/[id]/patches/[patchId]/route",
  "@/app/api/papers/documents/[id]/template/route",
  "@/app/api/papers/documents/[id]/imports/route",
] as const;

describe("paper editor retirement", () => {
  it.each(READ_ONLY_ROUTES)("%s keeps GET and exposes no write verb", async (path) => {
    const route = (await import(/* @vite-ignore */ path)) as Record<string, unknown>;
    expect(typeof route.GET).toBe("function");
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) expect(method in route).toBe(false);
  });

  it.each(REMOVED_ROUTES)("%s is no longer importable", async (path) => {
    await expect(import(/* @vite-ignore */ path)).rejects.toThrow();
  });
});
