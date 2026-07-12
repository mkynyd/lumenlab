import { describe, expect, it } from "vitest";
import { mapAgentRunInput, parseChatRequest } from "./request-mapper";

const validBody = {
  message: "hello",
  model: "deepseek-v4-pro",
};

describe("parseChatRequest", () => {
  it("maps the existing JSON body and applies validator defaults", async () => {
    const request = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validBody),
    });

    await expect(parseChatRequest(request)).resolves.toEqual({
      body: {
        ...validBody,
        thinkingEnabled: true,
        reasoningEffort: "high",
        webSearchActive: false,
        skillOff: false,
        isQuickTask: false,
      },
      attachments: [],
    });
  });

  it("maps multipart attachments without changing the message contract", async () => {
    const upload = {
      name: "notes.md",
      type: "text/markdown",
      size: 12,
      arrayBuffer: async () => new TextEncoder().encode("course notes").buffer,
    };
    const request = {
      headers: new Headers({ "content-type": "multipart/form-data; boundary=test" }),
      formData: async () => ({
        get: (key: string) => (key === "message" ? JSON.stringify(validBody) : null),
        getAll: (key: string) => (key === "attachments" ? [upload] : []),
      }),
    } as unknown as Request;

    const parsed = await parseChatRequest(request);

    expect(parsed.body.message).toBe("hello");
    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments[0]).toMatchObject({
      name: "notes.md",
      mimeType: "text/markdown",
      size: 12,
    });
    expect(parsed.attachments[0].data.toString("utf8")).toBe("course notes");
  });

  it("rejects malformed input at the HTTP mapping boundary", async () => {
    const request = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...validBody, message: "" }),
    });

    await expect(parseChatRequest(request)).rejects.toThrow("消息不能为空");
  });

  it("maps every existing chat capability into the Runtime contract", () => {
    const signal = new AbortController().signal;
    const input = mapAgentRunInput({
      userId: "user-1",
      signal,
      parsed: {
        body: {
          message: "analyze selected files",
          hiddenPrompt: "full task",
          model: "minimax-m3",
          thinkingEnabled: true,
          reasoningEffort: "max",
          conversationId: "conversation-1",
          projectId: "project-1",
          selectedFileIds: ["file-1"],
          mode: "review",
          webSearchActive: true,
          manualSkillId: "paper-reader",
          skillOff: false,
          isQuickTask: true,
          materialScope: "project-corpus",
        },
        attachments: [],
      },
    });

    expect(input).toEqual({
      user: { id: "user-1" },
      conversation: { id: "conversation-1", projectId: "project-1" },
      prompt: {
        message: "analyze selected files",
        hiddenPrompt: "full task",
        attachments: [],
      },
      model: {
        requestedModel: "minimax-m3",
        thinkingEnabled: true,
        reasoningEffort: "max",
      },
      capabilities: {
        webSearchActive: true,
        manualSkillId: "paper-reader",
        skillOff: false,
        selectedFileIds: ["file-1"],
        mode: "review",
        isQuickTask: true,
        materialScope: "project-corpus",
      },
      signal,
    });
  });
});
