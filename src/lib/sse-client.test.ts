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
});
