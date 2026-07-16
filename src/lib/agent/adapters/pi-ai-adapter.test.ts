import { describe, expect, it, vi } from "vitest";
import type {
  AssistantMessage,
  AssistantMessageEvent,
} from "@earendil-works/pi-ai";
import {
  PiAiAdapter,
  type PiAiStreamRequest,
  type PiAiTransport,
} from "./pi-ai-adapter";
import type { ToolMetadata } from "@/lib/agent/types";

describe("PiAiAdapter POC", () => {
  it("routes DeepSeek V4 Pro through pi-ai with max thinking", async () => {
    const requests: PiAiStreamRequest[] = [];
    const transport = fakeTransport(requests, [
      { type: "thinking_delta", delta: "分析" },
      { type: "text_delta", delta: "回答" },
    ]);
    const adapter = new PiAiAdapter("deepseek", "sk-test", transport);

    const round = await adapter.startRound({
      model: "deepseek-v4-pro",
      messages: [
        { role: "system", content: "系统提示" },
        { role: "user", content: "你好" },
      ],
      thinkingEnabled: true,
      reasoningEffort: "max",
      activeTools: [],
    });

    expect(await collect(round.events)).toEqual([
      { type: "reasoning_delta", text: "分析" },
      { type: "text_delta", text: "回答" },
      {
        type: "usage",
        usage: {
          prompt_tokens: 9,
          completion_tokens: 4,
          total_tokens: 13,
          prompt_cache_hit_tokens: 0,
          prompt_cache_miss_tokens: 9,
        },
      },
    ]);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      providerId: "deepseek",
      modelId: "deepseek-v4-pro",
      apiKey: "sk-test",
      reasoning: "max",
      context: {
        systemPrompt: "系统提示",
        messages: [expect.objectContaining({ role: "user", content: "你好" })],
      },
    });
    expect(round.getRawReasoning()).toBe("分析");
    expect(round.getRawContent()).toBe("回答");
  });

  it("routes DeepSeek V4 Flash and disables pi thinking when the user selects standard mode", async () => {
    const requests: PiAiStreamRequest[] = [];
    const adapter = new PiAiAdapter(
      "deepseek",
      "sk-test",
      fakeTransport(requests, [])
    );

    const round = await adapter.startRound({
      model: "deepseek-v4-flash",
      messages: [{ role: "user", content: "hello" }],
      thinkingEnabled: false,
      reasoningEffort: "high",
      activeTools: [],
    });
    await collect(round.events);

    expect(requests[0]).toMatchObject({
      providerId: "deepseek",
      modelId: "deepseek-v4-flash",
      reasoning: undefined,
    });
  });

  it("maps MiniMax M3 images into pi-ai base64 image content", async () => {
    const requests: PiAiStreamRequest[] = [];
    const adapter = new PiAiAdapter(
      "minimax",
      "sk-test",
      fakeTransport(requests, [])
    );
    const round = await adapter.startRound({
      model: "minimax-m3",
      messages: [{ role: "user", content: "描述图片" }],
      thinkingEnabled: true,
      reasoningEffort: "high",
      activeTools: [],
      attachments: [
        {
          name: "chart.png",
          mimeType: "image/png",
          size: 5,
          data: Buffer.from("image"),
        },
      ],
    });
    await collect(round.events);

    expect(requests[0]).toMatchObject({
      providerId: "minimax-cn",
      modelId: "MiniMax-M3",
      reasoning: "high",
      context: {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "描述图片" },
              {
                type: "image",
                mimeType: "image/png",
                data: Buffer.from("image").toString("base64"),
              },
            ],
          },
        ],
      },
    });
  });

  it("uses native pi tools and replays a matching tool result on the next round", async () => {
    const requests: PiAiStreamRequest[] = [];
    const toolCall = {
      type: "toolCall" as const,
      id: "call-1",
      name: "project_files.list",
      arguments: { projectId: "p1" },
    };
    const transport: PiAiTransport = {
      stream: vi.fn((request) => {
        requests.push(request);
        return events([
          { type: "start", partial: message() },
          ...(requests.length === 1
            ? [
                {
                  type: "toolcall_start" as const,
                  contentIndex: 0,
                  partial: message(),
                },
                {
                  type: "toolcall_end" as const,
                  contentIndex: 0,
                  toolCall,
                  partial: message({ content: [toolCall] }),
                },
              ]
            : []),
          {
            type: "done" as const,
            reason: "stop" as const,
            message: message({
              content: requests.length === 1 ? [toolCall] : [],
              stopReason: requests.length === 1 ? "toolUse" : "stop",
            }),
          },
        ]);
      }),
    };
    const adapter = new PiAiAdapter("minimax", "sk-test", transport);
    const activeTools = [tool("project_files.list")];

    const first = await adapter.startRound({
      model: "minimax-m3",
      messages: [{ role: "user", content: "列出资料" }],
      thinkingEnabled: false,
      reasoningEffort: "high",
      activeTools,
    });
    await collect(first.events);

    expect(requests[0]?.context.tools).toEqual([
      {
        name: "lumen_70726f6a6563745f66696c65732e6c697374",
        description: "project_files.list description",
        parameters: { type: "object", properties: {} },
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

    const second = await adapter.continueRound({
      model: "minimax-m3",
      messages: first.requestMessages,
      thinkingEnabled: false,
      reasoningEffort: "high",
      activeTools,
      attachments: [],
      toolCalls: first.getToolCalls(),
      toolResults: [
        { toolUseId: "call-1", content: '{"files":["notes.md"]}' },
      ],
      rawContent: "",
    });
    await collect(second.events);

    expect(requests[1]?.context.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          content: [{
            ...toolCall,
            name: "lumen_70726f6a6563745f66696c65732e6c697374",
          }],
        }),
        expect.objectContaining({
          role: "toolResult",
          toolCallId: "call-1",
          toolName: "lumen_70726f6a6563745f66696c65732e6c697374",
          content: [{ type: "text", text: '{"files":["notes.md"]}' }],
        }),
      ])
    );
  });

  it("preserves pi cache usage as the existing cache-token contract", async () => {
    const requests: PiAiStreamRequest[] = [];
    const adapter = new PiAiAdapter(
      "deepseek",
      "sk-test",
      fakeTransport(requests, [], {
        input: 9,
        output: 4,
        cacheRead: 7,
        cacheWrite: 2,
        totalTokens: 22,
      })
    );
    const round = await adapter.startRound({
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: "hello" }],
      thinkingEnabled: false,
      reasoningEffort: "high",
      activeTools: [],
    });
    const items = await collect(round.events);

    expect(items.at(-1)).toEqual({
      type: "usage",
      usage: {
        prompt_tokens: 18,
        completion_tokens: 4,
        total_tokens: 22,
        prompt_cache_hit_tokens: 7,
        prompt_cache_miss_tokens: 11,
      },
    });
  });

  it("turns an aborted pi stream into AbortError", async () => {
    const controller = new AbortController();
    const transport: PiAiTransport = {
      stream: (request) =>
        eventsAfterAbort(request.signal, {
          type: "error",
          reason: "aborted",
          error: message({
            stopReason: "aborted",
            errorMessage: "cancelled upstream",
          }),
        }),
    };
    const adapter = new PiAiAdapter("deepseek", "sk-test", transport);
    const round = await adapter.startRound({
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: "hello" }],
      thinkingEnabled: false,
      reasoningEffort: "high",
      activeTools: [],
      signal: controller.signal,
    });
    const read = round.events.getReader().read();
    controller.abort();

    await expect(read).rejects.toMatchObject({ name: "AbortError" });
  });

  it("maps a pi provider HTTP error to the current provider-status shape", async () => {
    const transport: PiAiTransport = {
      stream: () =>
        events([
          { type: "start", partial: message() },
          {
            type: "error",
            reason: "error",
            error: message({
              stopReason: "error",
              errorMessage: "HTTP 429: quota exceeded",
            }),
          },
        ]),
    };
    const adapter = new PiAiAdapter("deepseek", "sk-test", transport);
    const round = await adapter.startRound({
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: "hello" }],
      thinkingEnabled: false,
      reasoningEffort: "high",
      activeTools: [],
    });

    await expect(collect(round.events)).rejects.toMatchObject({
      name: "PiAiProviderError",
      provider: "deepseek",
      status: 429,
      message: "DeepSeek 请求频率过高，请稍后重试",
    });
  });
});

function fakeTransport(
  requests: PiAiStreamRequest[],
  deltas: Array<
    | { type: "thinking_delta"; delta: string }
    | { type: "text_delta"; delta: string }
  >,
  usage: Partial<AssistantMessage["usage"]> = {}
): PiAiTransport {
  return {
    stream: vi.fn((request) => {
      requests.push(request);
      return events([
        { type: "start", partial: message(usageMessage(usage)) },
        ...deltas.map((delta) => ({
          ...delta,
          contentIndex: 0,
          partial: message(usageMessage(usage)),
        }) as AssistantMessageEvent),
        { type: "done", reason: "stop", message: message(usageMessage(usage)) },
      ]);
    }),
  };
}

async function* eventsAfterAbort(
  signal: AbortSignal | undefined,
  terminal: Extract<AssistantMessageEvent, { type: "error" }>
) {
  await new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    signal?.addEventListener("abort", () => resolve(), { once: true });
  });
  yield terminal;
}

async function* events(items: AssistantMessageEvent[]) {
  for (const item of items) yield item;
}

function message(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: "openai-completions",
    provider: "deepseek",
    model: "deepseek-v4-pro",
    usage: {
      input: 9,
      output: 4,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 13,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: 0,
    ...overrides,
  };
}

function usageMessage(usage: Partial<AssistantMessage["usage"]>) {
  return {
    usage: {
      input: usage.input ?? 9,
      output: usage.output ?? 4,
      cacheRead: usage.cacheRead ?? 0,
      cacheWrite: usage.cacheWrite ?? 0,
      totalTokens: usage.totalTokens ?? 13,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  } satisfies Partial<AssistantMessage>;
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
