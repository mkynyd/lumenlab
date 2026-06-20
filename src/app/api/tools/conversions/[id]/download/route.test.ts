// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  conversionFindFirst: vi.fn(),
  conversionUpdateMany: vi.fn(),
  readStoredObject: vi.fn(),
  uploadObjectBuffer: vi.fn(),
  deleteStoredObject: vi.fn(),
  renderMarkdownPdf: vi.fn(),
  buildConversionPackage: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({
  prisma: {
    documentConversion: {
      findFirst: mocks.conversionFindFirst,
      updateMany: mocks.conversionUpdateMany,
    },
  },
}));
vi.mock("@/lib/storage/object-storage", () => ({
  readStoredObject: mocks.readStoredObject,
  uploadObjectBuffer: mocks.uploadObjectBuffer,
  deleteStoredObject: mocks.deleteStoredObject,
}));
vi.mock("@/lib/export/browser-pdf", () => ({
  renderMarkdownPdf: mocks.renderMarkdownPdf,
}));
vi.mock("@/lib/export/conversion-package", () => ({
  buildConversionPackage: mocks.buildConversionPackage,
  sanitizeExportBaseName: (value: string) => value,
}));

import { GET } from "@/app/api/tools/conversions/[id]/download/route";

const context = { params: Promise.resolve({ id: "conversion-1" }) };

function request() {
  return new Request(
    "http://localhost:3000/api/tools/conversions/conversion-1/download",
    { headers: { cookie: "session=secret" } }
  );
}

describe("GET conversion package", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.conversionFindFirst.mockResolvedValue({
      id: "conversion-1",
      userId: "user-1",
      originalName: "lecture.pdf",
      markdownContent: "# Lecture\n\n![图](pics/circuit.png)",
      exportStorageProvider: null,
      exportStoragePath: null,
      assets: [
        {
          relativePath: "pics/circuit.png",
          mimeType: "image/png",
          storageProvider: "local",
          storagePath: "assets/circuit.png",
        },
      ],
    });
    mocks.readStoredObject.mockResolvedValue(Buffer.from([1, 2, 3]));
    mocks.renderMarkdownPdf.mockResolvedValue(Buffer.from("%PDF-test"));
    mocks.buildConversionPackage.mockResolvedValue(Buffer.from("PK-package"));
    mocks.uploadObjectBuffer.mockResolvedValue({
      provider: "local",
      key: "exports/lecture.zip",
    });
    mocks.conversionUpdateMany.mockResolvedValue({ count: 1 });
    mocks.deleteStoredObject.mockResolvedValue(undefined);
  });

  it("requires ownership", async () => {
    mocks.conversionFindFirst.mockResolvedValue(null);

    const response = await GET(request(), context);

    expect(response.status).toBe(404);
    expect(mocks.renderMarkdownPdf).not.toHaveBeenCalled();
  });

  it("returns a cached package without launching Chromium", async () => {
    mocks.conversionFindFirst.mockResolvedValue({
      id: "conversion-1",
      userId: "user-1",
      originalName: "lecture.pdf",
      markdownContent: "# Lecture",
      exportStorageProvider: "local",
      exportStoragePath: "exports/cached.zip",
      assets: [],
    });
    mocks.readStoredObject.mockResolvedValue(Buffer.from("PK-cached"));

    const response = await GET(request(), context);

    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe("PK-cached");
    expect(mocks.readStoredObject).toHaveBeenCalledWith({
      provider: "local",
      key: "exports/cached.zip",
    });
    expect(mocks.renderMarkdownPdf).not.toHaveBeenCalled();
  });

  it("generates, stores, and returns a complete package on cache miss", async () => {
    const response = await GET(request(), context);

    expect(mocks.renderMarkdownPdf).toHaveBeenCalledWith({
      requestUrl: request().url,
      conversionId: "conversion-1",
      cookieHeader: "session=secret",
    });
    expect(mocks.buildConversionPackage).toHaveBeenCalledWith({
      baseName: "lecture",
      markdownContent: "# Lecture\n\n![图](pics/circuit.png)",
      pdfBuffer: Buffer.from("%PDF-test"),
      assets: [
        {
          relativePath: "pics/circuit.png",
          mimeType: "image/png",
          buffer: Buffer.from([1, 2, 3]),
        },
      ],
    });
    expect(mocks.uploadObjectBuffer).toHaveBeenCalledWith(
      expect.objectContaining({
        key: expect.stringMatching(
          /^users\/user-1\/conversions\/conversion-1\/exports\/[^/]+\.zip$/
        ),
        mimeType: "application/zip",
        buffer: Buffer.from("PK-package"),
      })
    );
    expect(mocks.conversionUpdateMany).toHaveBeenCalledWith({
      where: { id: "conversion-1", userId: "user-1", exportStoragePath: null },
      data: expect.objectContaining({
        exportStorageProvider: "local",
        exportStoragePath: "exports/lecture.zip",
        exportSize: 10,
        exportGeneratedAt: expect.any(Date),
      }),
    });
    expect(response.headers.get("Content-Type")).toBe("application/zip");
    expect(response.headers.get("Content-Disposition")).toContain("lecture.zip");
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe("PK-package");
  });
});
