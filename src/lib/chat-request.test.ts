import { describe, expect, it } from "vitest";
import { buildChatRequestBody } from "@/lib/chat-request";

describe("buildChatRequestBody", () => {
  const base = {
    conversationId: undefined,
    message: "分析选中的实验数据",
    model: "deepseek-v4-pro",
    thinkingEnabled: false,
    reasoningEffort: "high" as const,
  };

  it("includes project context for project chat", () => {
    expect(
      buildChatRequestBody({
        ...base,
        projectId: "project-1",
        selectedFileIds: ["file-1", "file-2"],
        mode: "experiment",
      })
    ).toEqual({
      ...base,
      projectId: "project-1",
      selectedFileIds: ["file-1", "file-2"],
      mode: "experiment",
    });
  });

  it("keeps ordinary chat requests free of project fields", () => {
    expect(buildChatRequestBody(base)).toEqual(base);
  });
});
