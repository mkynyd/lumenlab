import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {
    status = 500;
  }
  return {
    default: class Anthropic {
      static APIError = APIError;
      messages = {
        create: mocks.create,
      };
    },
  };
});

import {
  completeChat,
  createTextMessage,
  DeepSeekError,
  mapDeepSeekModel,
  streamChat,
} from "@/lib/deepseek";
// 触发工具注册，确保 DSML fallback 能校验真实 tool id
import "@/lib/tools/registry";

async function readStreamText(stream: ReadableStream<Uint8Array>) {
  return new Response(stream).text();
}

describe("mapDeepSeekModel", () => {
  it("upgrades legacy and unknown ids to the active Responses model", () => {
    expect(mapDeepSeekModel("deepseek-v4-flash-vision-exp")).toBe(
      "deepseek-v4-flash-vision-exp"
    );
    expect(mapDeepSeekModel("deepseek-v4-pro")).toBe(
      "deepseek-v4-flash-vision-exp"
    );
    expect(mapDeepSeekModel("deepseek-v4-flash")).toBe(
      "deepseek-v4-flash-vision-exp"
    );
    expect(mapDeepSeekModel("unknown-model")).toBe(
      "deepseek-v4-flash-vision-exp"
    );
  });
});

describe("non-streaming Responses calls", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts createTextMessage to /responses with the active model", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "resp-1",
          status: "completed",
          output_text: "  标题结果  ",
          output: [],
        }),
        { status: 200 }
      )
    );

    await expect(
      createTextMessage("sk-test", {
        model: "deepseek-v4-flash",
        system: "系统提示",
        prompt: "生成标题",
        maxTokens: 128,
        temperature: 0.2,
      })
    ).resolves.toBe("标题结果");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.deepseek.com/responses");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer sk-test",
      Accept: "application/json",
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "deepseek-v4-flash-vision-exp",
      input: [{ role: "user", content: [{ type: "input_text", text: "生成标题" }] }],
      instructions: "系统提示",
      max_output_tokens: 128,
      reasoning: { effort: "none" },
      temperature: 0.2,
      stream: false,
    });
  });

  it("maps completeChat output items, reasoning, tools, choice, and usage", async () => {
    const output = [
      {
        id: "reasoning-1",
        type: "reasoning",
        content: [{ type: "reasoning_text", text: "先分析" }],
      },
      {
        id: "message-1",
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "最终答案" }],
      },
    ];
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "resp-2",
          status: "completed",
          output,
          usage: {
            input_tokens: 10,
            input_tokens_details: { cached_tokens: 4 },
            output_tokens: 6,
            output_tokens_details: { reasoning_tokens: 2 },
            total_tokens: 16,
          },
        }),
        { status: 200 }
      )
    );

    const result = await completeChat("sk-test", {
      model: "deepseek-v4-pro",
      messages: [
        { role: "system", content: "系统" },
        { role: "user", content: "问题" },
      ],
      thinking: { type: "enabled" },
      reasoning_effort: "max",
      max_tokens: 512,
      tools: [{ name: "web_search", input_schema: { type: "object" } }],
      tool_choice: { type: "tool", name: "web_search" },
    });

    expect(result).toMatchObject({
      content: "最终答案",
      reasoningContent: "先分析",
      usage: {
        prompt_tokens: 10,
        prompt_cache_hit_tokens: 4,
        prompt_cache_miss_tokens: 6,
        completion_tokens: 6,
        total_tokens: 16,
      },
      rawContentBlocks: output,
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body).toMatchObject({
      model: "deepseek-v4-flash-vision-exp",
      max_output_tokens: 512,
      reasoning: { effort: "max" },
      tools: [{ type: "function", name: "web_search", parameters: { type: "object" } }],
      tool_choice: { type: "function", name: "web_search" },
      stream: false,
    });
  });

  it("preserves HTTP status and upstream detail as DeepSeekError", async () => {
    fetchMock.mockResolvedValue(
      new Response('{"error":{"message":"invalid credential"}}', { status: 401 })
    );

    const failure = await createTextMessage("bad-key", {
      system: "系统",
      prompt: "问题",
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(DeepSeekError);
    expect(failure).toMatchObject({ status: 401 });
    expect((failure as Error).message).toContain("invalid credential");
  });

  it.each([
    [{ status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [] }, 502],
    [{ status: "completed", output: [] }, 502],
    [{
      status: "completed",
      output: [{ type: "message", content: [{ type: "refusal", refusal: "不支持该请求" }] }],
    }, 400],
  ])("rejects non-success Responses payloads", async (payload, status) => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(payload), { status: 200 })
    );
    const failure = await completeChat("sk-test", {
      model: "deepseek-v4-flash-vision-exp",
      messages: [{ role: "user", content: "问题" }],
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(DeepSeekError);
    expect(failure).toMatchObject({ status });
  });
});

describe("streamChat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("captures raw XML/DSML tool markup while keeping the streamed output sanitized", async () => {
    async function* anthropicEvents() {
      yield {
        type: "message_start",
        message: { usage: { input_tokens: 3 } },
      };
      yield {
        type: "content_block_delta",
        delta: {
          type: "text_delta",
          text: '先检查资料。\n<tool_calls><invoke name="project_files.list"><parameter name="projectId">project-1</parameter></invoke></tool_calls>',
        },
      };
      yield {
        type: "message_delta",
        usage: { output_tokens: 4 },
      };
    }
    mocks.create.mockResolvedValue(anthropicEvents());

    const result = await streamChat("sk-test", {
      model: "deepseek-v4-pro",
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "hi" },
      ],
      thinking: { type: "enabled" },
      reasoning_effort: "max",
    });

    const body = await readStreamText(result.stream);

    expect(body).toContain("先检查资料。");
    expect(body).not.toContain("<tool_calls>");
    expect(body).not.toContain("invoke name");
    expect(result.getToolCalls()).toEqual([]);
    expect(result.getRawContent()).toContain(
      '<tool_calls><invoke name="project_files.list">'
    );
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "deepseek-v4-flash-vision-exp",
        output_config: { effort: "max" },
      })
    );
  });

  it("captures native tool_use blocks from the stream", async () => {
    async function* anthropicEvents() {
      yield {
        type: "message_start",
        message: { usage: { input_tokens: 3 } },
      };
      yield {
        type: "content_block_start",
        content_block: { type: "tool_use", id: "tu-1", name: "project_files.list" },
      };
      yield {
        type: "content_block_delta",
        delta: { type: "input_json_delta", partial_json: '{"projectId":"project-1"}' },
      };
      yield {
        type: "content_block_stop",
      };
      yield {
        type: "message_delta",
        usage: { output_tokens: 4 },
      };
    }
    mocks.create.mockResolvedValue(anthropicEvents());

    const result = await streamChat("sk-test", {
      model: "deepseek-v4-pro",
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "hi" },
      ],
    });

    await readStreamText(result.stream);

    expect(result.getToolCalls()).toEqual([
      {
        id: "tu-1",
        name: "project_files.list",
        input: { projectId: "project-1" },
      },
    ]);
  });
});
