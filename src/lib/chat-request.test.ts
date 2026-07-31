import { describe, it, expect } from "vitest";
import { buildChatRequestBody } from "./chat-request";

describe("buildChatRequestBody", () => {
  it("透传稳定的 durable clientRunKey", () => {
    const body = buildChatRequestBody({
      clientRunKey: "019fb0b8-0c05-7893-8911-7101206d2644",
      message: "继续任务",
      model: "deepseek-v4-pro",
      thinkingEnabled: true,
      reasoningEffort: "high",
    });
    expect(body.clientRunKey).toBe(
      "019fb0b8-0c05-7893-8911-7101206d2644"
    );
  });

  it("透传 isQuickTask", () => {
    const body = buildChatRequestBody({
      message: "快捷任务：总结要点",
      hiddenPrompt: "请总结项目资料要点",
      model: "deepseek-v4-pro",
      thinkingEnabled: true,
      reasoningEffort: "max",
      projectId: "proj-123",
      isQuickTask: true,
    });
    expect(body.isQuickTask).toBe(true);
  });

  it("非快捷任务不包含 isQuickTask", () => {
    const body = buildChatRequestBody({
      message: "你好",
      model: "deepseek-v4-pro",
      thinkingEnabled: true,
      reasoningEffort: "max",
    });
    expect(body.isQuickTask).toBeUndefined();
  });
});
