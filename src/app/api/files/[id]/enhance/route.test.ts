// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  fileFindFirst: vi.fn(),
  fileUpdate: vi.fn(),
  getProviderApiKey: vi.fn(),
  createTextMessage: vi.fn(),
  recordFileContentChange: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({
  prisma: {
    fileAsset: {
      findFirst: mocks.fileFindFirst,
      update: mocks.fileUpdate,
    },
  },
}));
vi.mock("@/lib/data/provider-access", () => ({
  getProviderApiKey: mocks.getProviderApiKey,
}));
vi.mock("@/lib/deepseek", () => ({
  createTextMessage: mocks.createTextMessage,
  DeepSeekError: class DeepSeekError extends Error {},
}));
vi.mock("@/lib/provider-access", () => ({
  ProviderAccessError: class ProviderAccessError extends Error {},
}));
vi.mock("@/lib/learning/services", () => ({
  recordFileContentChange: mocks.recordFileContentChange,
}));

import { POST } from "@/app/api/files/[id]/enhance/route";

describe("POST /api/files/[id]/enhance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.fileFindFirst.mockResolvedValue({
      id: "file-1",
      userId: "user-1",
      status: "parsed",
      textContent: "OCR 正文",
      contentFingerprint: "sha256:v1:previous",
      processingMetadata: {},
    });
    mocks.fileUpdate.mockResolvedValue({});
    mocks.getProviderApiKey.mockResolvedValue("secret-key");
    mocks.createTextMessage.mockResolvedValue("增强后的当前正文");
    mocks.recordFileContentChange.mockResolvedValue({
      changed: true,
      knowledgePoints: [],
      practiceItems: [],
    });
  });

  it("versions the effective content when enhancement succeeds", async () => {
    const response = await POST(new Request("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ id: "file-1" }),
    });

    expect(response.status).toBe(200);
    expect(mocks.fileUpdate).toHaveBeenLastCalledWith({
      where: { id: "file-1" },
      data: expect.objectContaining({
        enhancedContent: "增强后的当前正文",
        enhancementStatus: "enhanced",
        contentFingerprint: expect.stringMatching(/^sha256:v1:[a-f0-9]{64}$/),
      }),
    });
    expect(mocks.recordFileContentChange).toHaveBeenCalledWith({
      userId: "user-1",
      fileAssetId: "file-1",
      previousFingerprint: "sha256:v1:previous",
      currentFingerprint: expect.stringMatching(/^sha256:v1:[a-f0-9]{64}$/),
    });
  });

  it("keeps a successful enhancement successful when freshness projection fails", async () => {
    mocks.recordFileContentChange.mockRejectedValueOnce(
      new Error("freshness unavailable")
    );

    const response = await POST(new Request("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ id: "file-1" }),
    });

    expect(response.status).toBe(200);
    expect(mocks.fileUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ enhancementStatus: "enhanced" }),
      })
    );
  });
});
