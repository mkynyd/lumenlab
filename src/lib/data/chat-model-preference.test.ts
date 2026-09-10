import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ conversation: vi.fn(), project: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: {
  conversation: { findFirst: mocks.conversation },
  project: { findFirst: mocks.project },
} }));
import { resolveStoredChatModel } from "./chat-model-preference";

beforeEach(() => vi.resetAllMocks());

describe("request model inheritance", () => {
  it("defaults a new ordinary chat to Qwen without querying or rewriting history", async () => {
    await expect(resolveStoredChatModel("owner", {})).resolves.toBe("qwen3.8-flash");
    expect(mocks.conversation).not.toHaveBeenCalled();
    expect(mocks.project).not.toHaveBeenCalled();
  });

  it.each([
    ["minimax-m3", "minimax-m3"],
    ["deepseek-v4-flash-vision-exp", "deepseek-flash"],
    ["deepseek-v4-flash", "deepseek-flash"],
    ["deepseek-v4-pro", "deepseek-flash"],
    ["deepseek-flash", "deepseek-flash"],
    ["qwen3.7-plus", "qwen3.8-flash"],
    ["unknown", "unknown"],
  ])("preserves or upgrades saved conversation %s", async (saved, expected) => {
    mocks.conversation.mockResolvedValue({ model: saved });
    await expect(resolveStoredChatModel("owner", { conversationId: "chat", projectId: "project" })).resolves.toBe(expected);
    expect(mocks.conversation).toHaveBeenCalledWith({ where: { id: "chat", userId: "owner" }, select: { model: true } });
    expect(mocks.project).not.toHaveBeenCalled();
  });

  it("inherits a project's explicit selection for its new conversations", async () => {
    mocks.project.mockResolvedValue({ defaultModel: "minimax-m3" });
    await expect(resolveStoredChatModel("owner", { projectId: "project" })).resolves.toBe("minimax-m3");
    expect(mocks.project).toHaveBeenCalledWith({ where: { id: "project", userId: "owner" }, select: { defaultModel: true } });
  });

  it.each([{ conversationId: "other-chat" }, { projectId: "other-project" }])("fails closed when the requested resource is not owned", async (context) => {
    mocks.conversation.mockResolvedValue(null);
    mocks.project.mockResolvedValue(null);
    await expect(resolveStoredChatModel("owner", context)).rejects.toThrow("无权访问");
  });
});
