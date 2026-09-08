import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  attachmentFindFirst: vi.fn(),
  readStoredObject: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({
  prisma: { messageAttachment: { findFirst: mocks.attachmentFindFirst } },
}));
vi.mock("@/lib/storage/object-storage", () => ({
  readStoredObject: mocks.readStoredObject,
}));

import { GET } from "@/app/api/chat/attachments/[id]/route";

function attachment(overrides: Record<string, unknown> = {}) {
  return {
    mimeType: "image/png",
    storageProvider: "local",
    storagePath: "chat-attachments/user-1/run-1/0-abc.png",
    thumbnailProvider: "local",
    thumbnailPath: "chat-attachments/user-1/run-1/0-abc-thumb.webp",
    ...overrides,
  };
}

describe("GET /api/chat/attachments/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.attachmentFindFirst.mockResolvedValue(attachment());
    mocks.readStoredObject.mockResolvedValue(Buffer.from("thumb-bytes"));
  });

  it("scopes the lookup to the owning user and serves the thumbnail by default", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/chat/attachments/att-1"),
      { params: Promise.resolve({ id: "att-1" }) }
    );

    expect(mocks.attachmentFindFirst).toHaveBeenCalledWith({
      where: { id: "att-1", userId: "user-1" },
      select: {
        mimeType: true,
        storageProvider: true,
        storagePath: true,
        thumbnailProvider: true,
        thumbnailPath: true,
      },
    });
    expect(mocks.readStoredObject).toHaveBeenCalledWith({
      provider: "local",
      key: "chat-attachments/user-1/run-1/0-abc-thumb.webp",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toBe("private, max-age=300");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("serves the original bytes for variant=original", async () => {
    mocks.readStoredObject.mockResolvedValue(Buffer.from("original-bytes"));

    const response = await GET(
      new NextRequest(
        "http://localhost/api/chat/attachments/att-1?variant=original"
      ),
      { params: Promise.resolve({ id: "att-1" }) }
    );

    expect(mocks.readStoredObject).toHaveBeenCalledWith({
      provider: "local",
      key: "chat-attachments/user-1/run-1/0-abc.png",
    });
    expect(response.headers.get("content-type")).toBe("image/png");
  });

  it("falls back to the original when no thumbnail exists", async () => {
    mocks.attachmentFindFirst.mockResolvedValue(
      attachment({ thumbnailProvider: null, thumbnailPath: null })
    );

    await GET(
      new NextRequest("http://localhost/api/chat/attachments/att-1"),
      { params: Promise.resolve({ id: "att-1" }) }
    );

    expect(mocks.readStoredObject).toHaveBeenCalledWith({
      provider: "local",
      key: "chat-attachments/user-1/run-1/0-abc.png",
    });
  });

  it("returns 404 for another user's attachment", async () => {
    mocks.attachmentFindFirst.mockResolvedValue(null);

    const response = await GET(
      new NextRequest("http://localhost/api/chat/attachments/att-2"),
      { params: Promise.resolve({ id: "att-2" }) }
    );

    expect(response.status).toBe(404);
    expect(mocks.readStoredObject).not.toHaveBeenCalled();
  });

  it("returns 410 when the stored object is gone", async () => {
    mocks.readStoredObject.mockRejectedValue(new Error("ENOENT"));

    const response = await GET(
      new NextRequest("http://localhost/api/chat/attachments/att-1"),
      { params: Promise.resolve({ id: "att-1" }) }
    );

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({
      code: "attachment_unavailable",
    });
  });

  it("requires authentication", async () => {
    mocks.auth.mockResolvedValue(null);

    const response = await GET(
      new NextRequest("http://localhost/api/chat/attachments/att-1"),
      { params: Promise.resolve({ id: "att-1" }) }
    );

    expect(response.status).toBe(401);
  });
});
