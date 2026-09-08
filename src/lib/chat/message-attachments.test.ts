import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  attachmentUpsert: vi.fn(),
  attachmentUpdateMany: vi.fn(),
  attachmentFindMany: vi.fn(),
  attachmentDeleteMany: vi.fn(),
  attachmentCount: vi.fn(),
  fileCount: vi.fn(),
  resourceCount: vi.fn(),
  uploadObjectBuffer: vi.fn(),
  deleteStoredObject: vi.fn(),
  activeStorageProvider: vi.fn(),
  sharp: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    messageAttachment: {
      upsert: mocks.attachmentUpsert,
      updateMany: mocks.attachmentUpdateMany,
      findMany: mocks.attachmentFindMany,
      deleteMany: mocks.attachmentDeleteMany,
      count: mocks.attachmentCount,
    },
    fileAsset: { count: mocks.fileCount },
    fileAssetResource: { count: mocks.resourceCount },
  },
}));

vi.mock("@/lib/storage/object-storage", () => ({
  uploadObjectBuffer: mocks.uploadObjectBuffer,
  deleteStoredObject: mocks.deleteStoredObject,
  activeStorageProvider: mocks.activeStorageProvider,
  readStoredObject: vi.fn(),
}));

vi.mock("sharp", () => ({ default: mocks.sharp }));

import {
  bindChatAttachmentsToMessage,
  cleanupUnboundChatAttachments,
  deleteConversationAttachmentObjects,
  encodeChatAttachmentsHeader,
  persistChatAttachments,
  toChatAttachmentDto,
} from "@/lib/chat/message-attachments";
import type { ServerFileAttachment } from "@/lib/chat/router";

function imageAttachment(name = "red.png"): ServerFileAttachment {
  return {
    name,
    mimeType: "image/png",
    size: 8,
    data: Buffer.from("png-bytes"),
  };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "att-1",
    originalName: "red.png",
    mimeType: "image/png",
    size: 8,
    width: 1200,
    height: 800,
    contentHash: "a".repeat(64),
    storageProvider: "local",
    storagePath: "chat-attachments/user-1/run-1/0-aaaaaaaaaaaaaaaa.png",
    position: 0,
    status: "pending",
    thumbnailProvider: "local",
    thumbnailPath: "chat-attachments/user-1/run-1/0-aaaaaaaaaaaaaaaa-thumb.webp",
    ...overrides,
  };
}

describe("persistChatAttachments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.activeStorageProvider.mockReturnValue("local");
    mocks.uploadObjectBuffer.mockResolvedValue({ provider: "local", key: "k" });
    mocks.deleteStoredObject.mockResolvedValue(undefined);
    mocks.attachmentFindMany.mockResolvedValue([]);
    mocks.attachmentUpsert.mockImplementation(async ({ select, create }) =>
      row({ ...create, ...(select?.id ? { id: "att-1" } : {}) })
    );
    mocks.sharp.mockImplementation(() => ({
      metadata: async () => ({ width: 1200, height: 800 }),
      rotate: () => ({
        resize: () => ({
          webp: () => ({ toBuffer: async () => Buffer.from("thumb") }),
        }),
      }),
    }));
  });

  it("ignores non-image attachments", async () => {
    const result = await persistChatAttachments({
      userId: "user-1",
      clientRunKey: "run-1",
      attachments: [
        {
          name: "notes.pdf",
          mimeType: "application/pdf",
          size: 4,
          data: Buffer.from("pdf"),
        },
      ],
    });

    expect(result).toEqual([]);
    expect(mocks.uploadObjectBuffer).not.toHaveBeenCalled();
    expect(mocks.attachmentUpsert).not.toHaveBeenCalled();
  });

  it("uploads original and thumbnail under deterministic keys and upserts the row", async () => {
    const result = await persistChatAttachments({
      userId: "user-1",
      clientRunKey: "run-1",
      attachments: [imageAttachment()],
    });

    expect(mocks.uploadObjectBuffer).toHaveBeenNthCalledWith(1, {
      key: expect.stringMatching(
        /^chat-attachments\/user-1\/run-1\/0-[a-f0-9]{16}\.png$/
      ),
      mimeType: "image/png",
      buffer: Buffer.from("png-bytes"),
    });
    expect(mocks.uploadObjectBuffer).toHaveBeenNthCalledWith(2, {
      key: expect.stringMatching(
        /^chat-attachments\/user-1\/run-1\/0-[a-f0-9]{16}-thumb\.webp$/
      ),
      mimeType: "image/webp",
      buffer: Buffer.from("thumb"),
    });
    expect(mocks.attachmentUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_clientRunKey_position: {
            userId: "user-1",
            clientRunKey: "run-1",
            position: 0,
          },
        },
        create: expect.objectContaining({
          userId: "user-1",
          clientRunKey: "run-1",
          width: 1200,
          height: 800,
          status: "pending",
        }),
      })
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "att-1", status: "pending" });
  });

  it("keeps the original when the image cannot be decoded", async () => {
    mocks.sharp.mockImplementation(() => ({
      metadata: async () => {
        throw new Error("unsupported");
      },
    }));

    await persistChatAttachments({
      userId: "user-1",
      clientRunKey: "run-1",
      attachments: [imageAttachment()],
    });

    expect(mocks.uploadObjectBuffer).toHaveBeenCalledTimes(1);
    expect(mocks.attachmentUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          width: null,
          height: null,
          thumbnailPath: null,
        }),
      })
    );
  });

  it("reclaims stale unbound rows when a retry carries fewer images", async () => {
    mocks.attachmentFindMany.mockResolvedValue([
      {
        id: "att-stale",
        storageProvider: "local",
        storagePath: "chat-attachments/user-1/run-1/1-old.png",
        thumbnailProvider: null,
        thumbnailPath: null,
      },
    ]);
    mocks.attachmentCount.mockResolvedValue(0);
    mocks.fileCount.mockResolvedValue(0);
    mocks.resourceCount.mockResolvedValue(0);

    await persistChatAttachments({
      userId: "user-1",
      clientRunKey: "run-1",
      attachments: [imageAttachment()],
    });

    expect(mocks.attachmentDeleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["att-stale"] } },
    });
    expect(mocks.deleteStoredObject).toHaveBeenCalledWith({
      provider: "local",
      key: "chat-attachments/user-1/run-1/1-old.png",
    });
  });
});

describe("bindChatAttachmentsToMessage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("claims only rows that are still unbound", async () => {
    mocks.attachmentUpdateMany.mockResolvedValue({ count: 2 });

    const count = await bindChatAttachmentsToMessage({
      userId: "user-1",
      clientRunKey: "run-1",
      messageId: "message-1",
    });

    expect(count).toBe(2);
    expect(mocks.attachmentUpdateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", clientRunKey: "run-1", messageId: null },
      data: { messageId: "message-1", status: "bound" },
    });
  });
});

describe("attachment DTO", () => {
  it("points both variants at the owner-scoped route", () => {
    const persisted = row();
    const dto = toChatAttachmentDto({
      ...persisted,
      hasThumbnail: Boolean(persisted.thumbnailPath),
    });
    expect(dto).toMatchObject({
      id: "att-1",
      name: "red.png",
      url: "/api/chat/attachments/att-1?variant=original",
      thumbnailUrl: "/api/chat/attachments/att-1",
    });
    expect(
      JSON.parse(
        encodeChatAttachmentsHeader([
          { ...persisted, hasThumbnail: Boolean(persisted.thumbnailPath) },
        ])
      )
    ).toEqual([dto]);
  });
});

describe("attachment cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.attachmentCount.mockResolvedValue(0);
    mocks.fileCount.mockResolvedValue(0);
    mocks.resourceCount.mockResolvedValue(0);
    mocks.deleteStoredObject.mockResolvedValue(undefined);
  });

  it("deletes conversation-owned objects after removing their rows", async () => {
    mocks.attachmentFindMany.mockResolvedValue([row()]);

    await deleteConversationAttachmentObjects({
      userId: "user-1",
      conversationId: "conversation-1",
    });

    expect(mocks.attachmentDeleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1", message: { conversationId: "conversation-1" } },
    });
    expect(mocks.deleteStoredObject).toHaveBeenCalledTimes(2);
  });

  it("keeps objects still referenced by project files", async () => {
    mocks.attachmentFindMany.mockResolvedValue([row()]);
    mocks.fileCount.mockResolvedValue(1);

    await deleteConversationAttachmentObjects({
      userId: "user-1",
      conversationId: "conversation-1",
    });

    expect(mocks.deleteStoredObject).not.toHaveBeenCalled();
  });

  it("reclaims only unbound rows older than the TTL", async () => {
    mocks.attachmentFindMany.mockResolvedValue([row({ id: "att-old" })]);
    const now = new Date("2026-09-08T12:00:00.000Z");

    const result = await cleanupUnboundChatAttachments(now);

    expect(result).toEqual({ rows: 1 });
    expect(mocks.attachmentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          messageId: null,
          createdAt: { lt: new Date("2026-09-07T12:00:00.000Z") },
        },
      })
    );
    expect(mocks.attachmentDeleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["att-old"] } },
    });
  });
});
