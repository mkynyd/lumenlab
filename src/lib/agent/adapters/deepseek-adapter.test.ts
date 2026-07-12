import { describe, expect, it, vi } from "vitest";
import { DeepSeekAdapter } from "./deepseek-adapter";
import * as deepseek from "@/lib/deepseek";
import type { ToolMetadata } from "@/lib/agent/types";

vi.mock("@/lib/deepseek", async (importOriginal) => {
  const original = await importOriginal<typeof deepseek>();
  return {
    ...original,
    streamChat: vi.fn(),
  };
});

describe("DeepSeekAdapter", () => {
  it("forwards stream params and returns tool calls", async () => {
    vi.mocked(deepseek.streamChat).mockResolvedValue({
      stream: new ReadableStream(),
      getUsage: () => ({
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      }),
      getToolCalls: () => [
        { id: "tc-1", name: "web_search", input: { query: "test" } },
      ],
      getRawContent: () => "",
      getRawReasoning: () => "",
    });

    const adapter = new DeepSeekAdapter("sk-test");
    const result = await adapter.stream({
      model: "deepseek-v4-pro",
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "hi" },
      ],
      thinkingEnabled: true,
      reasoningEffort: "max",
      tools: [{ type: "web_search_20250305", name: "web_search" }],
    });

    expect(deepseek.streamChat).toHaveBeenCalledWith("sk-test", {
      model: "deepseek-v4-pro",
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "hi" },
      ],
      thinking: { type: "enabled" },
      reasoning_effort: "max",
      tools: [{ type: "web_search_20250305", name: "web_search" }],
    });
    expect(result.getToolCalls()).toHaveLength(1);
    expect(result.getUsage()?.total_tokens).toBe(15);
  });

  it("keeps XML fallback and native-name normalization inside the adapter", async () => {
    vi.mocked(deepseek.streamChat).mockResolvedValue({
      stream: new ReadableStream(),
      getUsage: () => null,
      getToolCalls: () => [
        { id: "native-1", name: "web_search", input: { query: "runtime" } },
      ],
      getRawContent: () =>
        '<tool_calls><invoke name="project_files.list"><parameter name="projectId">p1</parameter></invoke></tool_calls>',
      getRawReasoning: () => "",
    });

    const tools = [
      tool("web.search", { query: { type: "string" } }, ["query"]),
      tool("project_files.list", { projectId: { type: "string" } }, ["projectId"]),
    ];
    const adapter = new DeepSeekAdapter("sk-test");
    const round = await adapter.startRound({
      model: "deepseek-v4-pro",
      messages: [{ role: "system", content: "system prompt" }],
      thinkingEnabled: true,
      reasoningEffort: "max",
      activeTools: tools,
    });

    const request = vi.mocked(deepseek.streamChat).mock.calls.at(-1)?.[1];
    expect(request?.tools).toEqual([
      {
        name: "web_search",
        description: "web.search description",
        input_schema: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        },
      },
    ]);
    expect(String(request?.messages[0].content)).toContain("<tool_calls>");
    expect(String(request?.messages[0].content)).toContain("project_files.list");
    expect(round.getToolCalls()).toEqual([
      {
        id: "native-1",
        name: "web.search",
        input: { query: "runtime" },
        source: "native",
      },
      {
        id: "parsed-project_files.list-0",
        name: "project_files.list",
        input: { projectId: "p1" },
        source: "xml_dsml",
      },
    ]);
  });

  it("continues XML fallback as text instead of inventing an unexposed native tool", async () => {
    vi.mocked(deepseek.streamChat).mockResolvedValue({
      stream: new ReadableStream(),
      getUsage: () => null,
      getToolCalls: () => [],
      getRawContent: () => "final",
      getRawReasoning: () => "",
    });

    const adapter = new DeepSeekAdapter("sk-test");
    await adapter.continueRound({
      model: "deepseek-v4-pro",
      messages: [
        { role: "system", content: "system prompt" },
        { role: "user", content: "list files" },
      ],
      thinkingEnabled: true,
      reasoningEffort: "max",
      activeTools: [
        tool("project_files.list", { projectId: { type: "string" } }, ["projectId"]),
      ],
      toolCalls: [
        {
          id: "parsed-project_files.list-0",
          name: "project_files.list",
          input: { projectId: "p1" },
          source: "xml_dsml",
        },
      ],
      toolResults: [
        {
          toolUseId: "parsed-project_files.list-0",
          content: '{"files":["notes.md"]}',
        },
      ],
      rawContent:
        '<tool_calls><invoke name="project_files.list"><parameter name="projectId">p1</parameter></invoke></tool_calls>',
    });

    const request = vi.mocked(deepseek.streamChat).mock.calls.at(-1)?.[1];
    const continuation = request?.messages.slice(-2);
    expect(continuation?.[0]).toEqual({
      role: "assistant",
      content: [{ type: "text", text: "调用 XML 工具：project_files.list" }],
    });
    expect(continuation?.[1]).toEqual({
      role: "user",
      content: [
        {
          type: "text",
          text: '# XML 工具结果\n\nproject_files.list: {"files":["notes.md"]}',
        },
      ],
    });
  });

  it("does not duplicate fallback instructions across continuation rounds", async () => {
    vi.mocked(deepseek.streamChat).mockResolvedValue({
      stream: new ReadableStream(),
      getUsage: () => null,
      getToolCalls: () => [],
      getRawContent: () => "",
      getRawReasoning: () => "",
    });
    const adapter = new DeepSeekAdapter("sk-test");
    const activeTools = [
      tool("project_files.list", { projectId: { type: "string" } }, [
        "projectId",
      ]),
    ];
    const first = await adapter.startRound({
      model: "deepseek-v4-pro",
      messages: [{ role: "system", content: "system prompt" }],
      thinkingEnabled: true,
      reasoningEffort: "max",
      activeTools,
    });

    await adapter.continueRound({
      model: "deepseek-v4-pro",
      messages: first.requestMessages,
      thinkingEnabled: true,
      reasoningEffort: "max",
      activeTools,
      toolCalls: [
        {
          id: "parsed-project_files.list-0",
          name: "project_files.list",
          input: { projectId: "p1" },
          source: "xml_dsml",
        },
      ],
      toolResults: [
        {
          toolUseId: "parsed-project_files.list-0",
          content: '{"files":[]}',
        },
      ],
      rawContent: "",
    });

    const request = vi.mocked(deepseek.streamChat).mock.calls.at(-1)?.[1];
    const system = String(request?.messages[0].content);
    expect(system.match(/你可以调用以下工具/g)).toHaveLength(1);
  });
});

function tool(
  toolId: string,
  properties: Record<string, unknown>,
  required: string[]
): ToolMetadata {
  return {
    toolId,
    name: toolId,
    description: `${toolId} description`,
    inputSchema: { type: "object", properties, required },
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
