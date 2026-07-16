import { describe, expect, it, vi } from "vitest";
import {
  BailianQwenAdapter,
  type DashScopeStreamRequest,
  type DashScopeTransport,
} from "./bailian-qwen-adapter";
import type { ToolMetadata } from "@/lib/agent/types";

describe("BailianQwenAdapter", () => {
  it("uses DashScope native thinking, tools, cache usage, and the configured workspace endpoint", async () => {
    const requests: DashScopeStreamRequest[] = [];
    const adapter = new BailianQwenAdapter(
      "ba-test",
      "https://workspace.example.cn-beijing.maas.aliyuncs.com/api/v1",
      fakeTransport(requests, [
        {
          output: {
            choices: [{
              message: {
                reasoning_content: "先分析",
                content: [{ text: "我会调用工具。" }],
                tool_calls: [{
                  id: "call-1",
                  type: "function",
                  function: {
                    name: "project_files.list",
                    arguments: '{"projectId":"p1"}',
                  },
                }],
              },
            }],
          },
          usage: {
            input_tokens: 10,
            output_tokens: 4,
            total_tokens: 14,
            input_tokens_details: { cached_tokens: 3 },
          },
        },
      ])
    );

    const first = await adapter.startRound({
      model: "qwen3.7-plus",
      messages: [
        { role: "system", content: "系统提示" },
        { role: "user", content: "列出资料" },
      ],
      thinkingEnabled: true,
      reasoningEffort: "max",
      activeTools: [tool("project_files.list")],
    });

    expect(await collect(first.events)).toEqual([
      { type: "reasoning_delta", text: "先分析" },
      { type: "text_delta", text: "我会调用工具。" },
      {
        type: "usage",
        usage: {
          prompt_tokens: 10,
          completion_tokens: 4,
          total_tokens: 14,
          prompt_cache_hit_tokens: 3,
          prompt_cache_miss_tokens: 7,
        },
      },
    ]);
    expect(first.getToolCalls()).toEqual([
      {
        id: "call-1",
        name: "project_files.list",
        input: { projectId: "p1" },
        source: "native",
      },
    ]);
    expect(requests[0]).toMatchObject({
      endpoint: "https://workspace.example.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
      apiKey: "ba-test",
      body: {
        model: "qwen3.7-plus",
        input: {
          messages: [
            { role: "system", content: [{ text: "系统提示" }] },
            { role: "user", content: [{ text: "列出资料" }] },
          ],
        },
        parameters: {
          enable_thinking: true,
          preserve_thinking: true,
          incremental_output: true,
          result_format: "message",
          tools: [{
            type: "function",
            function: {
              name: "project_files.list",
              description: "project_files.list description",
              parameters: { type: "object", properties: {} },
            },
          }],
        },
      },
    });

    const second = await adapter.continueRound({
      model: "qwen3.7-plus",
      messages: first.requestMessages,
      thinkingEnabled: true,
      reasoningEffort: "max",
      activeTools: [tool("project_files.list")],
      attachments: [],
      toolCalls: first.getToolCalls(),
      toolResults: [{ toolUseId: "call-1", content: '{"files":["notes.md"]}' }],
      rawContent: first.getRawContent(),
    });
    await collect(second.events);

    expect(requests[1]?.body.input.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: "assistant",
        tool_calls: [{
          id: "call-1",
          type: "function",
          function: {
            name: "project_files.list",
            arguments: '{"projectId":"p1"}',
          },
        }],
      }),
      {
        role: "tool",
        tool_call_id: "call-1",
        content: [{ text: '{"files":["notes.md"]}' }],
      },
    ]));
  });

  it("maps image attachments to DashScope native image blocks", async () => {
    const requests: DashScopeStreamRequest[] = [];
    const adapter = new BailianQwenAdapter(
      "ba-test",
      "https://workspace.example.cn-beijing.maas.aliyuncs.com/api/v1",
      fakeTransport(requests, [])
    );

    const round = await adapter.startRound({
      model: "qwen3.7-plus",
      messages: [{ role: "user", content: "描述这张图" }],
      thinkingEnabled: false,
      reasoningEffort: "high",
      activeTools: [],
      attachments: [{
        name: "diagram.png",
        mimeType: "image/png",
        size: 3,
        data: Buffer.from("png"),
      }],
    });
    await collect(round.events);

    expect(requests[0]?.body.input.messages.at(-1)).toEqual({
      role: "user",
      content: [
        { text: "描述这张图" },
        { image: "data:image/png;base64,cG5n" },
      ],
    });
  });

  it("merges DashScope streamed tool-call argument fragments into one native call", async () => {
    const adapter = new BailianQwenAdapter(
      "ba-test",
      "https://workspace.example.cn-beijing.maas.aliyuncs.com/api/v1",
      fakeTransport([], [
        {
          output: {
            choices: [{
              message: {
                tool_calls: [{
                  index: 0,
                  id: "call-streamed",
                  type: "function",
                  function: {
                    name: "project_files.list",
                    arguments: '{"project',
                  },
                }],
              },
            }],
          },
        },
        {
          output: {
            choices: [{
              message: {
                tool_calls: [{
                  index: 0,
                  id: "",
                  function: { arguments: 'Id":"p1"}' },
                }],
              },
            }],
          },
        },
      ])
    );

    const round = await adapter.startRound({
      model: "qwen3.7-plus",
      messages: [{ role: "user", content: "列出资料" }],
      thinkingEnabled: false,
      reasoningEffort: "high",
      activeTools: [tool("project_files.list")],
    });
    await collect(round.events);

    expect(round.getToolCalls()).toEqual([{
      id: "call-streamed",
      name: "project_files.list",
      input: { projectId: "p1" },
      source: "native",
    }]);
  });

  it("maps video attachments to native DashScope video blocks and removes their temporary object", async () => {
    const requests: DashScopeStreamRequest[] = [];
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const adapter = new BailianQwenAdapter(
      "ba-test",
      "https://workspace.example.cn-beijing.maas.aliyuncs.com/api/v1",
      fakeTransport(requests, []),
      async () => ({
        part: { video: "https://media.example.test/short-lived.mp4" },
        cleanup,
      })
    );

    const round = await adapter.startRound({
      model: "qwen3.7-plus",
      messages: [{ role: "user", content: "总结视频中的实验步骤" }],
      thinkingEnabled: true,
      reasoningEffort: "max",
      activeTools: [],
      attachments: [{
        name: "experiment.mp4",
        mimeType: "video/mp4",
        size: 3,
        data: Buffer.from("mp4"),
      }],
    });
    await collect(round.events);

    expect(requests[0]?.body.input.messages.at(-1)).toEqual({
      role: "user",
      content: [
        { text: "总结视频中的实验步骤" },
        { video: "https://media.example.test/short-lived.mp4" },
      ],
    });
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("propagates cancellation and maps DashScope HTTP errors", async () => {
    const controller = new AbortController();
    const transport: DashScopeTransport = {
      stream: vi.fn(async function* (request) {
        await new Promise<void>((resolve) => {
          request.signal?.addEventListener("abort", () => resolve(), { once: true });
        });
        throw Object.assign(new Error("rate limit"), { status: 429 });
      }),
    };
    const adapter = new BailianQwenAdapter(
      "ba-test",
      "https://workspace.example.cn-beijing.maas.aliyuncs.com/api/v1",
      transport
    );
    const round = await adapter.startRound({
      model: "qwen3.7-plus",
      messages: [{ role: "user", content: "hello" }],
      thinkingEnabled: false,
      reasoningEffort: "high",
      activeTools: [],
      signal: controller.signal,
    });
    const read = round.events.getReader().read();
    controller.abort();
    await expect(read).rejects.toMatchObject({ name: "AbortError" });

    const rateLimited = new BailianQwenAdapter(
      "ba-test",
      "https://workspace.example.cn-beijing.maas.aliyuncs.com/api/v1",
      { stream: async function* () { throw Object.assign(new Error("quota"), { status: 429 }); } }
    );
    const failed = await rateLimited.startRound({
      model: "qwen3.7-plus",
      messages: [{ role: "user", content: "hello" }],
      thinkingEnabled: false,
      reasoningEffort: "high",
      activeTools: [],
    });
    await expect(collect(failed.events)).rejects.toMatchObject({
      name: "BailianQwenError",
      status: 429,
      message: "Qwen 请求频率过高，请稍后重试",
    });
  });
});

function fakeTransport(
  requests: DashScopeStreamRequest[],
  events: unknown[]
): DashScopeTransport {
  return {
    stream: vi.fn(async function* (request) {
      requests.push(request);
      for (const event of events) yield event;
    }),
  };
}

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

async function collect<T>(stream: ReadableStream<T>) {
  const reader = stream.getReader();
  const result: T[] = [];
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) return result;
      result.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
}
