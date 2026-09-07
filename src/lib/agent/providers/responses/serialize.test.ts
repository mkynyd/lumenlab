import { describe, expect, it } from "vitest";
import {
  attachmentsToContentParts,
  buildDeepSeekResponsesBody,
  buildMiniMaxResponsesBody,
  buildQwenResponsesBody,
  messagesToInputItems,
  toResponsesFunctionTool,
  toResponsesToolName,
  fromResponsesToolName,
  ResponsesSerializationError,
  type BuildResponsesBodyInput,
} from "./serialize";
import type { ServerFileAttachment } from "@/lib/chat/router";
import type { DeepSeekMessage } from "@/lib/deepseek";

function attachment(
  name: string,
  mimeType: string,
  data = "bytes"
): ServerFileAttachment {
  return { name, mimeType, size: data.length, data: Buffer.from(data) };
}

function baseInput(
  overrides: Partial<BuildResponsesBodyInput> = {}
): BuildResponsesBodyInput {
  return {
    model: "wire-model",
    messages: [{ role: "user", content: "你好" }],
    thinkingEnabled: false,
    reasoningEffort: "high",
    ...overrides,
  };
}

describe("messagesToInputItems", () => {
  it("moves system messages into instructions and joins them", () => {
    const { instructions, input } = messagesToInputItems([
      { role: "system", content: "第一条" },
      { role: "system", content: "第二条" },
      { role: "user", content: "问题" },
    ]);
    expect(instructions).toBe("第一条\n\n第二条");
    expect(input).toEqual([
      { role: "user", content: [{ type: "input_text", text: "问题" }] },
    ]);
  });

  it("serializes multi-turn history with role-specific text parts", () => {
    const { input } = messagesToInputItems([
      { role: "user", content: "你好" },
      { role: "assistant", content: "你好，有什么可以帮你？" },
      { role: "user", content: "介绍下你自己" },
    ]);
    expect(input).toEqual([
      { role: "user", content: [{ type: "input_text", text: "你好" }] },
      {
        role: "assistant",
        content: [{ type: "output_text", text: "你好，有什么可以帮你？" }],
      },
      { role: "user", content: [{ type: "input_text", text: "介绍下你自己" }] },
    ]);
  });

  it("serializes a tool round: reasoning, function_call, function_call_output", () => {
    const messages: DeepSeekMessage[] = [
      { role: "user", content: "查一下资料" },
      {
        role: "assistant",
        reasoning_content: "需要调用搜索",
        content: [
          { type: "text", text: "我来查一下。" },
          {
            type: "tool_use",
            id: "call-1",
            name: "web_search",
            input: { query: "课程资料" },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "call-1",
            content: "找到 3 条结果",
          },
        ],
      },
    ];
    const { input } = messagesToInputItems(messages);
    expect(input).toEqual([
      { role: "user", content: [{ type: "input_text", text: "查一下资料" }] },
      {
        type: "reasoning",
        content: [{ type: "reasoning_text", text: "需要调用搜索" }],
      },
      {
        role: "assistant",
        content: [{ type: "output_text", text: "我来查一下。" }],
      },
      {
        type: "function_call",
        call_id: "call-1",
        name: "web_search",
        arguments: '{"query":"课程资料"}',
      },
      {
        type: "function_call_output",
        call_id: "call-1",
        output: "找到 3 条结果",
      },
    ]);
  });

  it("keeps text alongside tool results in the same user turn", () => {
    const { input } = messagesToInputItems([
      {
        role: "user",
        content: [
          { type: "text", text: "工具结果如下" },
          { type: "tool_result", tool_use_id: "call-9", content: "ok" },
        ],
      },
    ]);
    expect(input).toEqual([
      { role: "user", content: [{ type: "input_text", text: "工具结果如下" }] },
      { type: "function_call_output", call_id: "call-9", output: "ok" },
    ]);
  });

  it("appends image attachments as input_image data URLs on the last user message", () => {
    const { input } = messagesToInputItems(
      [
        { role: "user", content: "先看这条" },
        { role: "assistant", content: "好的" },
        { role: "user", content: "这张图是什么？" },
      ],
      [attachment("photo.png", "image/png")]
    );
    const last = input[2];
    expect(last).toEqual({
      role: "user",
      content: [
        { type: "input_text", text: "这张图是什么？" },
        {
          type: "input_image",
          image_url: `data:image/png;base64,${Buffer.from("bytes").toString("base64")}`,
        },
      ],
    });
  });

  it("creates a user message for attachments when history has none", () => {
    const { input } = messagesToInputItems(
      [{ role: "assistant", content: "请先上传" }],
      [attachment("photo.png", "image/png")]
    );
    expect(input.at(-1)).toMatchObject({
      role: "user",
      content: [{ type: "input_image" }],
    });
  });

  it("skips text attachments and fail-closes on unconverted document formats", () => {
    expect(
      attachmentsToContentParts([attachment("notes.md", "text/markdown")])
    ).toEqual([]);
    expect(() =>
      attachmentsToContentParts([
        attachment("paper.pdf", "application/pdf"),
      ])
    ).toThrow(ResponsesSerializationError);
    expect(() =>
      attachmentsToContentParts([attachment("paper.pdf", "application/pdf")])
    ).toThrow(/转换为 PDF、DOCX 或图片/);
  });

  it("rejects video attachments unsupported by the shared Responses endpoints", () => {
    expect(() => attachmentsToContentParts([attachment("clip.mp4", "video/mp4")])).toThrow(/视频理解请选择 Qwen/);
  });
});

describe("toResponsesFunctionTool", () => {
  it("encodes dotted tool ids without underscore collisions and round-trips them", () => {
    const names = ["project_files.list", "project_files_list", "project_files_dlist"];
    const encoded = names.map(toResponsesToolName);
    expect(new Set(encoded).size).toBe(3);
    expect(encoded.map(fromResponsesToolName)).toEqual(names);
    expect(encoded.every((name) => /^[a-zA-Z0-9_-]+$/.test(name))).toBe(true);
    expect(() => toResponsesToolName("x".repeat(65))).toThrow(/限制/);
  });
  it("maps input_schema to parameters", () => {
    expect(
      toResponsesFunctionTool({
        name: "web_search",
        description: "搜索网络",
        input_schema: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        },
      })
    ).toEqual({
      type: "function",
      name: "web_search",
      description: "搜索网络",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    });
  });

  it("defaults parameters and omits an empty description", () => {
    expect(toResponsesFunctionTool({ name: "noop" })).toEqual({
      type: "function",
      name: "noop",
      parameters: { type: "object", properties: {} },
    });
  });
});

describe("buildDeepSeekResponsesBody", () => {
  it("explicitly controls thinking and never sends unsupported state fields", () => {
    const on = buildDeepSeekResponsesBody(
      baseInput({
        thinkingEnabled: true,
        reasoningEffort: "max",
        messages: [
          { role: "system", content: "系统" },
          { role: "user", content: "你好" },
        ],
        tools: [
          {
            name: "web_search",
            description: "d",
            input_schema: { type: "object", properties: {} },
          },
        ],
        toolChoice: "auto",
        temperature: 0.3,
        stream: true,
      })
    );
    expect(on.reasoning).toEqual({ effort: "max" });
    expect(on.instructions).toBe("系统");
    // web_search stays a client-side function tool, never the built-in type.
    expect(on.tools).toEqual([
      {
        type: "function",
        name: "web_search",
        description: "d",
        parameters: { type: "object", properties: {} },
      },
    ]);
    expect(on).not.toHaveProperty("store");
    expect(on).not.toHaveProperty("previous_response_id");
    expect(on).not.toHaveProperty("conversation");

    const off = buildDeepSeekResponsesBody(baseInput({ thinkingEnabled: false }));
    expect(off.reasoning).toEqual({ effort: "none" });
  });
});

describe("buildMiniMaxResponsesBody", () => {
  it("defaults reasoning to none and requires non-none effort when thinking", () => {
    const off = buildMiniMaxResponsesBody(baseInput({ thinkingEnabled: false }));
    expect(off.reasoning).toEqual({ effort: "none" });

    const on = buildMiniMaxResponsesBody(
      baseInput({ thinkingEnabled: true, reasoningEffort: "high" })
    );
    expect(on.reasoning?.effort).not.toBe("none");

    const max = buildMiniMaxResponsesBody(
      baseInput({ thinkingEnabled: true, reasoningEffort: "max" })
    );
    expect(max.reasoning).toEqual({ effort: "high" });
  });

  it("clamps temperature to (0, 1] and restricts tool_choice to none/auto", () => {
    const hot = buildMiniMaxResponsesBody(baseInput({ temperature: 1.5 }));
    expect(hot.temperature).toBe(1);
    const cold = buildMiniMaxResponsesBody(baseInput({ temperature: 0 }));
    expect(cold.temperature).toBeGreaterThan(0);

    const forced = buildMiniMaxResponsesBody(
      baseInput({ toolChoice: { type: "function", name: "x" } })
    );
    expect(forced.tool_choice).toBe("auto");
    const none = buildMiniMaxResponsesBody(baseInput({ toolChoice: "none" }));
    expect(none.tool_choice).toBe("none");
  });
});

describe("buildQwenResponsesBody", () => {
  it("encodes tools and places each result immediately after its matching call", () => {
    const body = buildQwenResponsesBody(baseInput({
      tools: [{ name: "project_files.list", input_schema: { type: "object" } }],
      messages: [
        { role: "assistant", content: [
          { type: "tool_use", id: "c1", name: "project_files.list", input: {} },
          { type: "tool_use", id: "c2", name: "project_files.list", input: {} },
        ] },
        { role: "user", content: [
          { type: "tool_result", tool_use_id: "c2", content: "second" },
          { type: "tool_result", tool_use_id: "c1", content: "first" },
        ] },
      ],
    }));
    expect(body.tools?.[0].name).toBe("project_ufiles_dlist");
    expect(body.input).toEqual([
      { type: "function_call", call_id: "c1", name: "project_ufiles_dlist", arguments: "{}" },
      { type: "function_call_output", call_id: "c1", output: "first" },
      { type: "function_call", call_id: "c2", name: "project_ufiles_dlist", arguments: "{}" },
      { type: "function_call_output", call_id: "c2", output: "second" },
    ]);
  });

  it("rejects missing tool results before sending a request", () => {
    expect(() => buildQwenResponsesBody(baseInput({ messages: [
      { role: "assistant", content: [{ type: "tool_use", id: "c1", name: "test", input: {} }] },
    ] }))).toThrow(/缺少对应结果/);
  });
  it("maps reasoning effort with medium as the default and never sends previous_response_id", () => {
    const off = buildQwenResponsesBody(baseInput({ thinkingEnabled: false }));
    expect(off.reasoning).toEqual({ effort: "none" });

    const def = buildQwenResponsesBody(
      baseInput({ thinkingEnabled: true, reasoningEffort: "high" })
    );
    expect(def.reasoning).toEqual({ effort: "medium" });

    const max = buildQwenResponsesBody(
      baseInput({ thinkingEnabled: true, reasoningEffort: "max" })
    );
    expect(max.reasoning).toEqual({ effort: "high" });

    expect(def).not.toHaveProperty("previous_response_id");
    expect(def.store).toBe(false);
  });

  it("rejects Qwen video before sending an undocumented wire item", () => {
    expect(() => buildQwenResponsesBody(baseInput({ attachments: [attachment("clip.mp4", "video/mp4")] }))).toThrow(/视频理解请选择 Qwen/);
  });
});
