import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { mapDeepSeekModel, streamChat } from "@/lib/deepseek";
// 触发工具注册，确保 DSML fallback 能校验真实 tool id
import "@/lib/tools/registry";

async function readStreamText(stream: ReadableStream<Uint8Array>) {
  return new Response(stream).text();
}

describe("mapDeepSeekModel", () => {
  it("passes official DeepSeek V4 model ids to the Anthropic-compatible API", () => {
    expect(mapDeepSeekModel("deepseek-v4-pro")).toBe("deepseek-v4-pro");
    expect(mapDeepSeekModel("deepseek-v4-flash")).toBe("deepseek-v4-flash");
    expect(mapDeepSeekModel("unknown-model")).toBe("deepseek-v4-flash");
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
        model: "deepseek-v4-pro",
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
