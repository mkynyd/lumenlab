import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getProviderApiKey: vi.fn(),
  parseFileWithMinerU: vi.fn(),
  conversionCreate: vi.fn(),
  storeConversionAssets: vi.fn(),
  deleteStoredObjects: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/data/provider-access", () => ({
  getProviderApiKey: mocks.getProviderApiKey,
}));
vi.mock("@/lib/parse/mineru", () => ({
  parseFileWithMinerU: mocks.parseFileWithMinerU,
  MinerUError: class MinerUError extends Error {
    constructor(
      public code: string | number,
      message: string
    ) {
      super(message);
      this.name = "MinerUError";
    }
  },
}));
vi.mock("@/lib/conversions/assets", () => ({
  storeConversionAssets: mocks.storeConversionAssets,
  deleteStoredObjects: mocks.deleteStoredObjects,
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    documentConversion: { create: mocks.conversionCreate },
  },
}));

import { POST } from "@/app/api/tools/pdf-to-markdown/route";
import { MinerUError } from "@/lib/parse/mineru";

function pdfRequest(options?: { token?: string; file?: File }) {
  const body = new FormData();
  body.append(
    "file",
    options?.file ||
      new File([new Uint8Array([1, 2, 3])], "lecture.pdf", {
        type: "application/pdf",
      })
  );
  if (options?.token) body.append("mineruToken", options.token);
  return { formData: async () => body } as unknown as Request;
}

describe("POST /api/tools/pdf-to-markdown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.getProviderApiKey.mockResolvedValue("managed-mineru-token");
    mocks.parseFileWithMinerU.mockImplementation(
      async ({ onProgress }: { onProgress?: (stage: string, progress?: { current: number; total: number }) => void }) => {
        onProgress?.("uploading");
        onProgress?.("pending");
        onProgress?.("model", { current: 3, total: 10 });
        return {
          content: "# Lecture",
          assets: [
            {
              relativePath: "pics/circuit.png",
              mimeType: "image/png",
              buffer: Buffer.from([1, 2, 3]),
            },
          ],
          metadata: {
            parser: "mineru-pipeline",
            taskId: "task-1",
            parsedAt: "2026-06-20T00:00:00.000Z",
          },
        };
      }
    );
    mocks.storeConversionAssets.mockResolvedValue([
      {
        id: "asset-1",
        relativePath: "pics/circuit.png",
        mimeType: "image/png",
        size: 3,
        storageProvider: "local",
        storagePath: "users/user-1/conversions/conversion-1/assets/asset-1/circuit.png",
      },
    ]);
    mocks.deleteStoredObjects.mockResolvedValue(undefined);
    mocks.conversionCreate.mockResolvedValue({
      id: "conversion-1",
      assets: [{ id: "asset-1", relativePath: "pics/circuit.png" }],
    });
  });

  it("rejects unauthenticated requests", async () => {
    mocks.auth.mockResolvedValue(null);

    const response = await POST(pdfRequest());

    expect(response.status).toBe(401);
    expect(mocks.parseFileWithMinerU).not.toHaveBeenCalled();
  });

  it("rejects non-PDF files before requesting a credential", async () => {
    const response = await POST(
      pdfRequest({
        file: new File(["hello"], "notes.txt", { type: "text/plain" }),
      })
    );

    expect(response.status).toBe(400);
    expect(mocks.getProviderApiKey).not.toHaveBeenCalled();
  });

  it("asks for a one-time token when the account has no MinerU credential", async () => {
    mocks.getProviderApiKey.mockRejectedValue(new Error("credential unavailable"));

    const response = await POST(pdfRequest());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "您的账户未开通文档解析服务，请在下方输入 MinerU Token",
      needToken: true,
      code: "need-token",
    });
  });

  it("includes a code in non-stream validation error responses", async () => {
    const response = await POST(
      pdfRequest({
        file: new File(["hello"], "notes.txt", { type: "text/plain" }),
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "请选择有效的 PDF 文件",
      code: "invalid-file",
    });
  });

  it("streams progress and persists the completed conversion", async () => {
    const response = await POST(pdfRequest({ token: "one-time-token" }));
    const stream = await response.text();

    expect(response.status).toBe(200);
    expect(mocks.parseFileWithMinerU).toHaveBeenCalledWith(
      expect.objectContaining({ token: "managed-mineru-token", filename: "lecture.pdf" })
    );
    expect(stream).toContain('"stage":"uploading"');
    expect(stream).toContain('"stage":"pending"');
    expect(stream).toContain('"stage":"model","extractedPages":3,"totalPages":10');
    expect(stream).toContain('"stage":"done","conversionId":"conversion-1"');
    expect(stream).toContain('"assetCount":1');
    expect(mocks.storeConversionAssets).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        conversionId: expect.any(String),
        assets: [expect.objectContaining({ relativePath: "pics/circuit.png" })],
      })
    );
    expect(mocks.conversionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: expect.any(String),
        userId: "user-1",
        title: "lecture",
        originalName: "lecture.pdf",
        markdownContent: "# Lecture",
        status: "completed",
        fileSize: 3,
        pageCount: 10,
        assets: {
          create: [
            expect.objectContaining({
              id: "asset-1",
              relativePath: "pics/circuit.png",
            }),
          ],
        },
      }),
      select: {
        id: true,
        assets: { select: { id: true, relativePath: true } },
      },
    });
  });

  it("uses the one-time token when the managed credential is unavailable", async () => {
    mocks.getProviderApiKey.mockRejectedValue(new Error("credential unavailable"));

    const response = await POST(pdfRequest({ token: "one-time-token" }));
    await response.text();

    expect(response.status).toBe(200);
    expect(mocks.parseFileWithMinerU).toHaveBeenCalledWith(
      expect.objectContaining({ token: "one-time-token" })
    );
  });

  it("emits a failed event when MinerU parsing fails", async () => {
    mocks.parseFileWithMinerU.mockRejectedValue(new Error("队列已满，请稍后重试"));

    const response = await POST(pdfRequest());
    const stream = await response.text();

    expect(response.status).toBe(200);
    expect(stream).toContain('"stage":"failed","error":"队列已满，请稍后重试"');
    expect(mocks.conversionCreate).not.toHaveBeenCalled();
  });

  it("includes the MinerUError code in the failed event payload", async () => {
    mocks.parseFileWithMinerU.mockRejectedValue(
      new MinerUError("-60009", "队列已满，请稍后重试")
    );

    const response = await POST(pdfRequest());
    const stream = await response.text();

    expect(response.status).toBe(200);
    expect(stream).toContain(
      '"stage":"failed","error":"队列已满，请稍后重试","code":"-60009"'
    );
    expect(mocks.conversionCreate).not.toHaveBeenCalled();
  });

  it("removes uploaded images when the conversion database write fails", async () => {
    mocks.conversionCreate.mockRejectedValue(new Error("database unavailable"));

    const response = await POST(pdfRequest());
    const stream = await response.text();

    expect(stream).toContain('"stage":"failed"');
    expect(mocks.deleteStoredObjects).toHaveBeenCalledWith([
      {
        provider: "local",
        key: "users/user-1/conversions/conversion-1/assets/asset-1/circuit.png",
      },
    ]);
  });
});
