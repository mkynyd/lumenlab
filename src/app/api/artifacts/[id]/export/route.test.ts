// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  artifactFindFirst: vi.fn(),
  markdownToDocx: vi.fn(),
  renderArtifactPdf: vi.fn(),
  validatePdfExport: vi.fn(),
  getCachedExport: vi.fn(),
  setCachedExport: vi.fn(),
  recordExportCacheResult: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({
  prisma: { artifact: { findFirst: mocks.artifactFindFirst } },
}));
vi.mock("@/lib/export/markdown-to-docx", () => ({
  markdownToDocx: mocks.markdownToDocx,
}));
vi.mock("@/lib/export/browser-pdf", () => ({
  renderArtifactPdf: mocks.renderArtifactPdf,
}));
vi.mock("@/lib/export/pdf-validation", () => ({
  validatePdfExport: mocks.validatePdfExport,
}));
vi.mock("@/lib/cache/export-cache", () => ({
  buildExportCacheKey: () => "export-key",
  getCachedExport: mocks.getCachedExport,
  setCachedExport: mocks.setCachedExport,
  recordExportCacheResult: mocks.recordExportCacheResult,
}));

import { GET } from "@/app/api/artifacts/[id]/export/route";

const context = { params: Promise.resolve({ id: "artifact-1" }) };

describe("GET artifact export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.artifactFindFirst.mockResolvedValue({
      id: "artifact-1",
      title: "实验总结",
      content: "# 有内容的成果",
    });
    mocks.getCachedExport.mockResolvedValue(null);
    mocks.renderArtifactPdf.mockResolvedValue(Buffer.from("%PDF-rendered"));
    mocks.validatePdfExport.mockResolvedValue({ pageCount: 1, hasVisibleContent: true });
  });

  it("prints an authenticated artifact surface and validates the resulting PDF", async () => {
    const request = new Request(
      "http://localhost:3000/api/artifacts/artifact-1/export?format=pdf",
      { headers: { cookie: "session=secret" } }
    );

    const response = await GET(request, context);

    expect(mocks.renderArtifactPdf).toHaveBeenCalledWith({
      requestUrl: request.url,
      artifactId: "artifact-1",
      cookieHeader: "session=secret",
    });
    expect(mocks.validatePdfExport).toHaveBeenCalledWith(Buffer.from("%PDF-rendered"));
    expect(mocks.setCachedExport).toHaveBeenCalledWith(
      "export-key",
      Buffer.from("%PDF-rendered")
    );
    expect(response.headers.get("X-Cache")).toBe("MISS");
  });

  it("returns a current cached export without launching Chromium", async () => {
    mocks.getCachedExport.mockResolvedValue(Buffer.from("%PDF-cached"));

    const response = await GET(
      new Request("http://localhost:3000/api/artifacts/artifact-1/export?format=pdf"),
      context
    );

    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe("%PDF-cached");
    expect(mocks.renderArtifactPdf).not.toHaveBeenCalled();
    expect(mocks.validatePdfExport).not.toHaveBeenCalled();
  });
});
