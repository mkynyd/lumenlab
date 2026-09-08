import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationHistoryMessage } from "@/lib/agent/persistence/conversation-persistence";

const mocks = vi.hoisted(() => ({
  readStoredObject: vi.fn(),
}));

vi.mock("@/lib/storage/object-storage", () => ({
  readStoredObject: mocks.readStoredObject,
}));

import {
  historyMediaRefs,
  resolveConversationMediaContext,
} from "@/lib/agent/context/conversation-media";

function historyMessage(
  id: string,
  attachments: Array<{ id: string; originalName: string }>,
  role = "user"
): ConversationHistoryMessage {
  return {
    id,
    role,
    content: "看看这张图",
    attachments: attachments.map((attachment) => ({
      ...attachment,
      mimeType: "image/png",
      storageProvider: "local",
      storagePath: `chat-attachments/user-1/${attachment.id}.png`,
      contentHash: "a".repeat(64),
    })),
  };
}

describe("historyMediaRefs", () => {
  it("returns image refs of user messages, most recent first", () => {
    const refs = historyMediaRefs([
      historyMessage("m-1", [{ id: "att-1", originalName: "old.png" }]),
      historyMessage("m-2", [], "assistant"),
      historyMessage("m-3", [
        { id: "att-2", originalName: "new.png" },
        { id: "att-3", originalName: "newer.png" },
      ]),
    ]);

    expect(refs.map((ref) => ref.id)).toEqual(["att-2", "att-3", "att-1"]);
    expect(refs.every((ref) => ref.source === "message-attachment")).toBe(true);
  });
});

describe("resolveConversationMediaContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readStoredObject.mockResolvedValue(Buffer.from("image-bytes"));
  });

  it("returns nothing when the conversation has no persisted images", async () => {
    const context = await resolveConversationMediaContext({
      history: [historyMessage("m-1", [])],
      prompt: "继续",
      maxCount: 6,
      maxBytes: 1024,
    });

    expect(context).toEqual({ attachments: [], note: null });
    expect(mocks.readStoredObject).not.toHaveBeenCalled();
  });

  it("re-reads history images by resource id and reports coverage", async () => {
    const context = await resolveConversationMediaContext({
      history: [
        historyMessage("m-1", [{ id: "att-1", originalName: "diagram.png" }]),
      ],
      prompt: "diagram 里的第二个节点是什么",
      maxCount: 6,
      maxBytes: 1024,
    });

    expect(mocks.readStoredObject).toHaveBeenCalledWith({
      provider: "local",
      key: "chat-attachments/user-1/att-1.png",
    });
    expect(context.attachments).toHaveLength(1);
    expect(context.note).toContain("1 张历史对话图片");
  });

  it("prioritises images mentioned in the current prompt", async () => {
    mocks.readStoredObject.mockImplementation(async ({ key }: { key: string }) => {
      if (key.includes("att-old")) return Buffer.alloc(600);
      return Buffer.alloc(10);
    });

    const context = await resolveConversationMediaContext({
      history: [
        historyMessage("m-1", [{ id: "att-old", originalName: "old.png" }]),
        historyMessage("m-2", [{ id: "att-new", originalName: "new.png" }]),
      ],
      prompt: "old 这张图里写了什么",
      // 只放得下一张，且 old 更大：按提及优先仍应选中 old
      maxCount: 1,
      maxBytes: 1024,
    });

    expect(context.attachments).toHaveLength(1);
    expect(context.attachments[0].name).toBe("old.png");
  });

  it("states why nothing was carried when the current turn consumed the budget", async () => {
    const context = await resolveConversationMediaContext({
      history: [
        historyMessage("m-1", [{ id: "att-1", originalName: "diagram.png" }]),
      ],
      prompt: "继续",
      maxCount: 0,
      maxBytes: 0,
    });

    expect(context.attachments).toEqual([]);
    expect(context.note).toContain("预算已被当前回合占用");
    expect(mocks.readStoredObject).not.toHaveBeenCalled();
  });

  it("skips unreadable history images without failing the turn", async () => {
    mocks.readStoredObject.mockRejectedValue(new Error("ENOENT"));

    const context = await resolveConversationMediaContext({
      history: [
        historyMessage("m-1", [{ id: "att-1", originalName: "gone.png" }]),
      ],
      prompt: "继续",
      maxCount: 6,
      maxBytes: 1024,
    });

    expect(context.attachments).toEqual([]);
    expect(context.note).toBeNull();
  });
});
