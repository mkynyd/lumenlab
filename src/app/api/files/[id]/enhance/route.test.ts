// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  fileFindFirst: vi.fn(),
  fileUpdate: vi.fn(),
  getProviderApiKey: vi.fn(),
  createTextMessage: vi.fn(),
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
  });

});
