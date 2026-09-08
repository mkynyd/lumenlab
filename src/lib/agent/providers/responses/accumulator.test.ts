import { describe, expect, it } from "vitest";
import { sanitizeModelText } from "@/lib/agent/tool-call-parser";
import {
  normalizeResponsesStream,
  ResponsesStreamAccumulator,
  type NormalizedResponsesEvent,
} from "./serialize";
import { ResponsesStreamInterruptedError } from "./transport";
import type { ResponsesStreamEvent, ResponsesUsage } from "./types";

async function* sourceOf(events: ResponsesStreamEvent[]) {
  for (const event of events) yield event;
}

async function collectNormalized(events: ResponsesStreamEvent[]) {
  const out: NormalizedResponsesEvent[] = [];
  for await (const event of normalizeResponsesStream(sourceOf(events))) {
    out.push(event);
  }
  return out;
}

function textOf(events: NormalizedResponsesEvent[]) {
  return events
    .filter((event) => event.type === "text_delta")
    .map((event) => (event as { text: string }).text)
    .join("");
}

function completedEvent(usage?: ResponsesUsage): ResponsesStreamEvent {
  return {
    type: "response.completed",
    response: { id: "r1", status: "completed", ...(usage ? { usage } : {}) },
  };
}

describe("ResponsesStreamAccumulator text channels", () => {
  it("fills done text independently for multiple output items and content parts", () => {
    const acc = new ResponsesStreamAccumulator();
    const events: NormalizedResponsesEvent[] = [];
    for (const [index, text] of ["first", "second"].entries()) {
      events.push(...acc.push({ type: "response.output_text.delta", item_id: `m${index}`, output_index: index, delta: text.slice(0, 2) }));
      events.push(...acc.push({ type: "response.output_text.done", item_id: `m${index}`, output_index: index, text }));
      events.push(...acc.push({ type: "response.output_text.done", item_id: `m${index}`, output_index: index, content_index: 1, text: "!" }));
    }
    expect(textOf(events)).toBe("first!second!");
    expect(acc.rawText).toBe("first!second!");
  });

  it("uses terminal output to recover missing done suffixes without duplicating deltas", () => {
    const acc = new ResponsesStreamAccumulator();
    const first = acc.push({ type: "response.output_text.delta", output_index: 0, delta: "Hel" });
    const terminal = acc.push({ type: "response.completed", response: {
      output: [{ id: "m1", type: "message", content: [{ type: "output_text", text: "Hello" }] }],
    } });
    expect(textOf([...first, ...terminal])).toBe("Hello");
    expect(acc.rawText).toBe("Hello");
    expect(acc.push(completedEvent({ input_tokens: 3, output_tokens: 4 }))).toEqual([]);
  });
  it("emits delta slices and never re-appends the done full text", () => {
    const acc = new ResponsesStreamAccumulator();
    const emitted = [
      ...acc.push({ type: "response.output_text.delta", delta: "Hello" }),
      ...acc.push({ type: "response.output_text.delta", delta: " world" }),
      ...acc.push({ type: "response.output_text.done", text: "Hello world" }),
    ];
    expect(textOf(emitted)).toBe("Hello world");
    expect(acc.rawText).toBe("Hello world");
  });

  it("fills the missing suffix when the done text is longer than the deltas", () => {
    const acc = new ResponsesStreamAccumulator();
    acc.push({ type: "response.output_text.delta", delta: "Hello" });
    const doneOut = acc.push({
      type: "response.output_text.done",
      text: "Hello world",
    });
    expect(textOf(doneOut)).toBe(" world");
    expect(acc.rawText).toBe("Hello world");
  });

  it("emits the full done text when no deltas arrived", () => {
    const acc = new ResponsesStreamAccumulator();
    const doneOut = acc.push({
      type: "response.output_text.done",
      text: "only-in-done",
    });
    expect(textOf(doneOut)).toBe("only-in-done");
    expect(acc.rawText).toBe("only-in-done");
  });

  it("keeps accumulated deltas as truth when the done payload diverges", () => {
    const acc = new ResponsesStreamAccumulator();
    acc.push({ type: "response.output_text.delta", delta: "abc" });
    const doneOut = acc.push({ type: "response.output_text.done", text: "xyz" });
    expect(textOf(doneOut)).toBe("");
    expect(acc.rawText).toBe("abc");
  });

  it("normalizes reasoning_text and reasoning_summary_text to reasoning deltas", () => {
    const acc = new ResponsesStreamAccumulator();
    const out = [
      ...acc.push({ type: "response.reasoning_text.delta", delta: "先想" }),
      ...acc.push({
        type: "response.reasoning_summary_text.delta",
        delta: "再想",
      }),
      ...acc.push({
        type: "response.reasoning_text.done",
        text: "先想再想",
      }),
    ];
    expect(out).toEqual([
      { type: "reasoning_delta", text: "先想" },
      { type: "reasoning_delta", text: "再想" },
    ]);
    expect(acc.rawReasoning).toBe("先想再想");
  });

  it("emits each reasoning slice once across delta, done, item.done and terminal", () => {
    const acc = new ResponsesStreamAccumulator();
    const events: NormalizedResponsesEvent[] = [
      ...acc.push({
        type: "response.output_item.added",
        output_index: 0,
        item: { id: "r1", type: "reasoning" },
      }),
      ...acc.push({
        type: "response.reasoning_text.delta",
        item_id: "r1",
        output_index: 0,
        delta: "先核对",
      }),
      ...acc.push({
        type: "response.reasoning_text.delta",
        item_id: "r1",
        output_index: 0,
        delta: "再回答",
      }),
      ...acc.push({
        type: "response.reasoning_text.done",
        item_id: "r1",
        output_index: 0,
        text: "先核对再回答",
      }),
      ...acc.push({
        type: "response.output_item.done",
        output_index: 0,
        item: {
          id: "r1",
          type: "reasoning",
          content: [{ type: "reasoning_text", text: "先核对再回答" }],
        },
      }),
      ...acc.push({
        type: "response.completed",
        response: {
          id: "resp-1",
          status: "completed",
          output: [
            {
              id: "r1",
              type: "reasoning",
              content: [{ type: "reasoning_text", text: "先核对再回答" }],
            },
            {
              id: "m1",
              type: "message",
              content: [{ type: "output_text", text: "答案" }],
            },
          ],
        },
      }),
    ];

    const reasoning = events
      .filter((event) => event.type === "reasoning_delta")
      .map((event) => (event as { text: string }).text)
      .join("");
    expect(reasoning).toBe("先核对再回答");
    expect(acc.rawReasoning).toBe("先核对再回答");
    expect(textOf(events)).toBe("答案");
    expect(acc.rawText).toBe("答案");
  });

  it("streams text through the same sanitization the legacy adapters use", async () => {
    const raw =
      "好的<tool_calls><invoke name=\"web.search\"></invoke></tool_calls>后续";
    const events = await collectNormalized([
      { type: "response.output_text.delta", delta: "好的<tool_calls><inv" },
      {
        type: "response.output_text.delta",
        delta: "oke name=\"web.search\"></invoke></tool_calls>",
      },
      { type: "response.output_text.delta", delta: "后续" },
      completedEvent(),
    ]);
    expect(textOf(events)).toBe(sanitizeModelText(raw));
    expect(textOf(events)).toBe("好的后续");
  });
});

describe("ResponsesStreamAccumulator function calls", () => {
  it("binds an argument delta received by output_index before the item id arrives", () => {
    const acc = new ResponsesStreamAccumulator();
    acc.push({ type: "response.function_call_arguments.delta", output_index: 2, delta: '{"x":' });
    acc.push({ type: "response.output_item.added", output_index: 2, item: { id: "f2", type: "function_call", call_id: "c2", name: "test" } });
    acc.push({ type: "response.function_call_arguments.delta", item_id: "f2", output_index: 2, delta: "1}" });
    acc.push({ type: "response.function_call_arguments.done", item_id: "f2", output_index: 2, arguments: '{"x":1}' });
    expect(acc.toolCalls).toMatchObject([{ callId: "c2", input: { x: 1 } }]);
    expect(acc.toolCalls).toHaveLength(1);
  });

  it("fails closed when the same output_index changes its item identity", () => {
    const acc = new ResponsesStreamAccumulator();
    acc.push({ type: "response.output_item.added", output_index: 0, item: { id: "a", type: "message" } });
    expect(() => acc.push({ type: "response.output_item.added", output_index: 0, item: { id: "b", type: "message" } })).toThrow(/item_id/);
  });

  it("rejects a completed response with unfinished or malformed tool arguments", () => {
    const acc = new ResponsesStreamAccumulator();
    acc.push({ type: "response.output_item.added", item: { id: "a", type: "function_call", call_id: "c", name: "test", arguments: "{}" } });
    expect(acc.toolCalls).toEqual([]);
    acc.push(completedEvent());
    expect(() => acc.finish()).toThrow(/工具调用不完整/);
  });
  it("accumulates interleaved calls by item_id and pairs call_id", async () => {
    const acc = new ResponsesStreamAccumulator();
    for (const event of [
      {
        type: "response.output_item.added",
        item: { id: "fc1", type: "function_call", call_id: "call-1", name: "search" },
      },
      { type: "response.function_call_arguments.delta", item_id: "fc1", delta: '{"q":"' },
      {
        type: "response.output_item.added",
        item: { id: "fc2", type: "function_call", call_id: "call-2", name: "search" },
      },
      { type: "response.function_call_arguments.delta", item_id: "fc2", delta: '{"q":"' },
      { type: "response.function_call_arguments.delta", item_id: "fc1", delta: 'a"}' },
      { type: "response.function_call_arguments.done", item_id: "fc2", arguments: '{"q":"b"}' },
      {
        type: "response.output_item.done",
        item: {
          id: "fc1",
          type: "function_call",
          call_id: "call-1",
          name: "search",
          arguments: '{"q":"a"}',
        },
      },
    ] satisfies ResponsesStreamEvent[]) {
      acc.push(event);
    }
    acc.push(completedEvent());
    // Identical name/arguments shape under different call ids must both survive.
    expect(acc.toolCalls).toEqual([
      {
        itemId: "fc1",
        callId: "call-1",
        name: "search",
        arguments: '{"q":"a"}',
        input: { q: "a" },
      },
      {
        itemId: "fc2",
        callId: "call-2",
        name: "search",
        arguments: '{"q":"b"}',
        input: { q: "b" },
      },
    ]);
  });

  it("lets arguments.done fill the gap without duplicating fragments", () => {
    const acc = new ResponsesStreamAccumulator();
    acc.push({
      type: "response.output_item.added",
      item: { id: "fc1", type: "function_call", call_id: "c1", name: "t" },
    });
    acc.push({
      type: "response.function_call_arguments.delta",
      item_id: "fc1",
      delta: '{"a":1',
    });
    acc.push({
      type: "response.function_call_arguments.done",
      item_id: "fc1",
      arguments: '{"a":1,"b":2}',
    });
    expect(acc.toolCalls[0]?.input).toEqual({ a: 1, b: 2 });
    expect(acc.toolCalls[0]?.arguments).toBe('{"a":1,"b":2}');
  });

  it("keeps two calls that share name and arguments but differ in call_id", () => {
    const acc = new ResponsesStreamAccumulator();
    for (const id of ["call-a", "call-b"]) {
      acc.push({
        type: "response.output_item.done",
        item: {
          id: `item-${id}`,
          type: "function_call",
          call_id: id,
          name: "same",
          arguments: '{"x":1}',
        },
      });
    }
    expect(acc.toolCalls.map((call) => call.callId)).toEqual([
      "call-a",
      "call-b",
    ]);
  });

  it("drops calls whose arguments are not valid JSON, like legacy flushToolUse", () => {
    const acc = new ResponsesStreamAccumulator();
    acc.push({
      type: "response.output_item.done",
      item: {
        id: "fc1",
        type: "function_call",
        call_id: "c1",
        name: "broken",
        arguments: "{oops",
      },
    });
    expect(acc.toolCalls).toEqual([]);
  });
});

describe("ResponsesStreamAccumulator terminal states", () => {
  it("remembers a streamed refusal even when the terminal omits output", () => {
    const acc = new ResponsesStreamAccumulator();
    acc.push({ type: "response.refusal.delta", delta: "cannot comply" });
    acc.push(completedEvent());
    expect(acc.terminal?.status).toBe("refused");
  });
  it("maps completed usage with the cache split and display-only reasoning tokens", async () => {
    const events = await collectNormalized([
      completedEvent({
        input_tokens: 100,
        input_tokens_details: { cached_tokens: 30 },
        output_tokens: 50,
        output_tokens_details: { reasoning_tokens: 20 },
        total_tokens: 150,
      }),
    ]);
    expect(events).toEqual([
      {
        type: "usage",
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
          prompt_cache_hit_tokens: 30,
          prompt_cache_miss_tokens: 70,
          reasoning_tokens: 20,
        },
      },
      {
        type: "terminal",
        terminal: { status: "completed", responseId: "r1" },
      },
    ]);
  });

  it("preserves missing cache measurements instead of reporting fabricated zeros", async () => {
    const events = await collectNormalized([
      completedEvent({ input_tokens: 8, output_tokens: 18, total_tokens: 26 }),
    ]);
    const usage = events.find((event) => event.type === "usage");
    expect(usage).toMatchObject({
      usage: {
        prompt_tokens: 8,
        completion_tokens: 18,
      },
    });
    expect(usage?.usage).not.toHaveProperty("prompt_cache_hit_tokens");
    expect(usage?.usage).not.toHaveProperty("prompt_cache_miss_tokens");
  });

  it("keeps incomplete distinct from failed and carries the reason", async () => {
    const events = await collectNormalized([
      {
        type: "response.incomplete",
        response: {
          id: "r2",
          status: "incomplete",
          incomplete_details: { reason: "max_output_tokens" },
          usage: { input_tokens: 5, output_tokens: 7 },
        },
      },
    ]);
    const terminal = events.find((event) => event.type === "terminal");
    expect(terminal).toMatchObject({
      terminal: { status: "incomplete", reason: "max_output_tokens" },
    });
    expect(events.some((event) => event.type === "usage")).toBe(true);
  });

  it("maps response.failed with upstream error details", async () => {
    const events = await collectNormalized([
      {
        type: "response.failed",
        response: {
          id: "r3",
          status: "failed",
          error: { code: "server_error", message: "boom" },
        },
      },
    ]);
    expect(events.at(-1)).toEqual({
      type: "terminal",
      terminal: {
        status: "failed",
        error: { code: "server_error", message: "boom" },
        responseId: "r3",
      },
    });
  });

  it("maps the top-level error event to a failed terminal", async () => {
    const events = await collectNormalized([
      { type: "error", code: "rate_limit", message: "slow down" },
    ]);
    expect(events.at(-1)).toEqual({
      type: "terminal",
      terminal: {
        status: "failed",
        error: { code: "rate_limit", message: "slow down" },
      },
    });
  });

  it("treats refusal content parts as refused, not completed", async () => {
    const events = await collectNormalized([
      {
        type: "response.completed",
        response: {
          id: "r4",
          status: "completed",
          output: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "refusal", refusal: "无法协助该请求" }],
            },
          ],
        },
      },
    ]);
    expect(events.at(-1)).toMatchObject({
      terminal: { status: "refused" },
    });
  });

  it("treats content_filter incompletes as refused, not truncated", async () => {
    const events = await collectNormalized([
      {
        type: "response.incomplete",
        response: {
          id: "r5",
          status: "incomplete",
          incomplete_details: { reason: "content_filter" },
        },
      },
    ]);
    expect(events.at(-1)).toMatchObject({
      terminal: { status: "refused", reason: "content_filter" },
    });
  });

  it("throws an interruption error on EOF without a terminal event", async () => {
    const failure = await collectNormalized([
      { type: "response.output_text.delta", delta: "half an answer" },
    ]).then(
      () => null,
      (error: unknown) => error
    );
    expect(failure).toBeInstanceOf(ResponsesStreamInterruptedError);
    expect((failure as ResponsesStreamInterruptedError).reason).toBe(
      "eof_without_terminal"
    );
  });

  it("finish() is a no-op after a terminal event", async () => {
    const acc = new ResponsesStreamAccumulator();
    const events: NormalizedResponsesEvent[] = [];
    for await (const event of normalizeResponsesStream(
      sourceOf([completedEvent()]),
      acc
    )) {
      events.push(event);
    }
    expect(events.at(-1)).toMatchObject({ terminal: { status: "completed" } });
    expect(acc.terminal?.status).toBe("completed");
    expect(() => acc.finish()).not.toThrow();
  });
});
