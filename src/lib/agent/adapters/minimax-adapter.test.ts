import { describe, expect, it, vi } from "vitest";
import { MiniMaxAdapter } from "./minimax-adapter";
import * as minimax from "@/lib/chat/minimax-chat";
import type { ToolMetadata } from "@/lib/agent/types";

vi.mock("@/lib/chat/minimax-chat", async (importOriginal) => {
  const original = await importOriginal<typeof minimax>();
  return {
    ...original,
    streamMiniMaxChat: vi.fn(),
  };
});

describe("MiniMaxAdapter", () => {
  it("forwards messages and attachments and exposes raw text / tool calls", async () => {
    vi.mocked(minimax.streamMiniMaxChat).mockResolvedValue({
      stream: new ReadableStream(),
      getUsage: () => ({
        prompt_tokens: 8,
        completion_tokens: 4,
        total_tokens: 12,
      }),
      getToolCalls: () => [],
      getRawContent: () => "",
      getRawReasoning: () => "",
    });

    const attachment = {
      name: "chart.png",
      mimeType: "image/png",
      size: 1024,
      data: Buffer.from("image"),
    };

    const adapter = new MiniMaxAdapter("sk-test");
    const result = await adapter.stream({
      model: "minimax-m3",
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "describe image" },
      ],
      thinkingEnabled: false,
      reasoningEffort: "high",
      attachments: [attachment],
    });

    expect(minimax.streamMiniMaxChat).toHaveBeenCalledWith("sk-test", {
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "describe image" },
      ],
      attachments: [attachment],
      thinking: false,
      maxTokens: 8192,
    });
    expect(result.getToolCalls()).toEqual([]);
    expect(result.getRawContent()).toBe("");
    expect(result.getRawReasoning()).toBe("");
    expect(result.getUsage()?.total_tokens).toBe(12);
  });

  it("forwards native tools to MiniMax", async () => {
    vi.mocked(minimax.streamMiniMaxChat).mockResolvedValue({
      stream: new ReadableStream(),
      getUsage: () => null,
      getToolCalls: () => [],
      getRawContent: () => "",
      getRawReasoning: () => "",
    });

    const adapter = new MiniMaxAdapter("sk-test");
    await adapter.stream({
      model: "minimax-m3",
      messages: [{ role: "user", content: "hi" }],
      thinkingEnabled: false,
      reasoningEffort: "high",
      tools: [
        {
          name: "project_files.list",
          description: "列出项目文件",
          input_schema: { type: "object", properties: {} },
        },
      ],
    });

    expect(minimax.streamMiniMaxChat).toHaveBeenCalledWith(
      "sk-test",
      expect.objectContaining({
        tools: [
          {
            name: "project_files.list",
            description: "列出项目文件",
            input_schema: { type: "object", properties: {} },
          },
        ],
        toolChoice: { type: "auto" },
      })
    );
  });

  it("treats XML/DSML as DeepSeek-only fallback", async () => {
    vi.mocked(minimax.streamMiniMaxChat).mockResolvedValue({
      stream: new ReadableStream(),
      getUsage: () => null,
      getToolCalls: () => [],
      getRawContent: () =>
        '<tool_calls><invoke name="project_files.list"><parameter name="projectId">p1</parameter></invoke></tool_calls>',
      getRawReasoning: () => "",
    });

    const adapter = new MiniMaxAdapter("sk-test");
    const round = await adapter.startRound({
      model: "minimax-m3",
      messages: [{ role: "user", content: "list files" }],
      thinkingEnabled: false,
      reasoningEffort: "high",
      activeTools: [tool("project_files.list")],
    });

    expect(round.getToolCalls()).toEqual([]);
  });

  it("continues native tool_use with a matching tool_result and no repeated attachments", async () => {
    vi.mocked(minimax.streamMiniMaxChat).mockResolvedValue({
      stream: new ReadableStream(),
      getUsage: () => null,
      getToolCalls: () => [],
      getRawContent: () => "done",
      getRawReasoning: () => "",
    });

    const adapter = new MiniMaxAdapter("sk-test");
    await adapter.continueRound({
      model: "minimax-m3",
      messages: [{ role: "user", content: "list files" }],
      thinkingEnabled: false,
      reasoningEffort: "high",
      activeTools: [tool("project_files.list")],
      attachments: [
        {
          name: "chart.png",
          mimeType: "image/png",
          size: 5,
          data: Buffer.from("image"),
        },
      ],
      toolCalls: [
        {
          id: "native-1",
          name: "project_files.list",
          input: { projectId: "p1" },
          source: "native",
        },
      ],
      toolResults: [
        { toolUseId: "native-1", content: '{"files":["notes.md"]}' },
      ],
      rawContent: "",
    });

    expect(minimax.streamMiniMaxChat).toHaveBeenCalledWith(
      "sk-test",
      expect.objectContaining({
        attachments: [],
        messages: [
          { role: "user", content: "list files" },
          {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "native-1",
                name: "project_files.list",
                input: { projectId: "p1" },
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "native-1",
                content: '{"files":["notes.md"]}',
              },
            ],
          },
        ],
      })
    );
  });

  it("records the exact thinking-filtered transcript used for the round", async () => {
    vi.mocked(minimax.streamMiniMaxChat).mockResolvedValue({
      stream: new ReadableStream(),
      getUsage: () => null,
      getToolCalls: () => [],
      getRawContent: () => "done",
      getRawReasoning: () => "",
    });

    const adapter = new MiniMaxAdapter("sk-test");
    const round = await adapter.startRound({
      model: "minimax-m3",
      messages: [
        { role: "assistant", content: "answer", reasoning_content: "private" },
        { role: "user", content: "continue" },
      ],
      thinkingEnabled: false,
      reasoningEffort: "high",
      activeTools: [],
    });

    expect(round.requestMessages).toEqual([
      { role: "assistant", content: "answer" },
      { role: "user", content: "continue" },
    ]);
    expect(minimax.streamMiniMaxChat).toHaveBeenCalledWith(
      "sk-test",
      expect.objectContaining({ messages: round.requestMessages })
    );
  });
});

function tool(toolId: string): ToolMetadata {
  return {
    toolId,
    name: toolId,
    description: `${toolId} description`,
    inputSchema: { type: "object", properties: {} },
    outputSchema: {},
    riskLevel: "L1",
    isReadOnly: true,
    hasExternalSideEffect: false,
    isReversible: true,
    containsSensitiveData: false,
    requiresNetwork: false,
    defaultApprovalMode: "auto",
    allowedSkillIds: [],
    auditLevel: "standard",
    requiredScopes: [],
  };
}
