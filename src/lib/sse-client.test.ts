import { describe, expect, it, vi } from "vitest";

import {
  readSSEStream,
  SSEExecutionError,
} from "./sse-client";

function reader(source: string) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(source));
      controller.close();
    },
  });
  return stream.getReader();
}

describe("durable SSE client", () => {
  it("tracks durable event IDs while ignoring envelope-only events", async () => {
    const onEventId = vi.fn();
    const chunks: string[] = [];
    const result = await readSSEStream(
      reader(
        [
          "id: 1",
          "event: durable",
          'data: {"schemaVersion":1,"agentExecutionId":"run-1","sequence":1,"type":"run_queued","payload":{}}',
          "",
          "id: 2",
          'data: {"choices":[{"delta":{"content":"hello"}}]}',
          "",
          "id: 3",
          "data: [DONE]",
          "",
          "",
        ].join("\n")
      ),
      (chunk) => chunks.push(chunk.content),
      { onEventId }
    );

    expect(onEventId.mock.calls.flat()).toEqual([1, 2, 3]);
    expect(chunks).toContain("hello");
    expect(result.done).toBe(true);
  });

  it("marks an abruptly closed stream as reconnectable", async () => {
    const result = await readSSEStream(
      reader('id: 4\ndata: {"choices":[{"delta":{"content":"partial"}}]}\n\n'),
      () => {}
    );
    expect(result.done).toBe(false);
  });

  it("surfaces a durable terminal failure instead of silently completing", async () => {
    await expect(
      readSSEStream(
        reader(
          'id: 5\nevent: execution_error\ndata: {"status":"failed","failureCode":"provider_error"}\n\n'
        ),
        () => {}
      )
    ).rejects.toEqual(
      new SSEExecutionError("执行失败，请重试", "failed", "provider_error")
    );
  });

  it("uses the server-provided message for a terminal failure", async () => {
    await expect(
      readSSEStream(
        reader(
          'id: 6\nevent: execution_error\ndata: {"status":"failed","failureCode":"no_readable_files","message":"当前项目没有可读取的已解析资料，请先上传资料并等待解析完成。"}\n\n'
        ),
        () => {}
      )
    ).rejects.toEqual(
      new SSEExecutionError(
        "当前项目没有可读取的已解析资料，请先上传资料并等待解析完成。",
        "failed",
        "no_readable_files"
      )
    );
  });

  it("falls back to the generic cancellation message when cancelled without a message", async () => {
    await expect(
      readSSEStream(
        reader(
          'id: 7\nevent: execution_error\ndata: {"status":"cancelled","failureCode":"execution_cancelled"}\n\n'
        ),
        () => {}
      )
    ).rejects.toEqual(
      new SSEExecutionError("执行已取消", "cancelled", "execution_cancelled")
    );
  });
});

describe("complete SSE frames", () => {
  it.each(["id: 9\n", 'id: 9\ndata: {"choices":[]}', 'id: 9\ndata: {"choices":[]}\n'])(
    "does not advance the cursor for a truncated frame %j",
    async (source) => {
      const cursor = vi.fn();
      const chunk = vi.fn();
      await readSSEStream(reader(source), chunk, { onEventId: cursor });
      expect(cursor).not.toHaveBeenCalled();
      expect(chunk).not.toHaveBeenCalled();
    },
  );

  it("consumes a complete UI event before advancing its sequence", async () => {
    const order: string[] = [];
    await readSSEStream(
      reader('id: 4\nevent: intelligent_ui\ndata: {"kind":"reset","messageId":"m1","attempt":1,"round":0}\n\n'),
      () => order.push("text"),
      { onEventId: (id) => order.push("id:" + id), onIntelligentUI: (event) => { order.push(event.kind); } },
    );
    expect(order).toEqual(["reset", "id:4"]);
  });

  it("preloads the renderer only for a valid append envelope", async () => {
    const valid = { kind: "append", messageId: "m1", attempt: 1, round: 0, from: 0, revision: 1, groups: ["{}"] };
    const malformed = [
      { ...valid, extra: true },
      { ...valid, revision: 9 },
      { ...valid, groups: [" ".repeat(14 * 1024 + 1)] },
    ];
    const payload = [...malformed, valid].map((value) =>
      `event: intelligent_ui\ndata: ${JSON.stringify(value)}\n\n`
    ).join("");
    const preload = vi.fn();
    const consume = vi.fn();
    await readSSEStream(reader(payload), vi.fn(), { onIntelligentUIAppend: preload, onIntelligentUI: consume });
    expect(preload).toHaveBeenCalledOnce();
    expect(consume).toHaveBeenCalledExactlyOnceWith(valid);
  });
});
