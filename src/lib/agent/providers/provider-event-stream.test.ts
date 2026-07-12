import { describe, expect, it } from "vitest";
import { normalizeProviderEventStream } from "./provider-event-stream";

describe("normalizeProviderEventStream", () => {
  it("normalizes split text, reasoning, and usage chunks", async () => {
    const encoder = new TextEncoder();
    const raw = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"choices":[{"delta":{"reasoning_content":"思'
          )
        );
        controller.enqueue(
          encoder.encode(
            '考"}}]}\n\ndata: {"choices":[{"delta":{"content":"回答"}}]}\n\n'
          )
        );
        controller.enqueue(
          encoder.encode(
            'data: {"usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5}}\n\ndata: [DONE]\n\n'
          )
        );
        controller.close();
      },
    });

    const events = await collect(normalizeProviderEventStream(raw));
    expect(events).toEqual([
      { type: "reasoning_delta", text: "思考" },
      { type: "text_delta", text: "回答" },
      {
        type: "usage",
        usage: {
          prompt_tokens: 2,
          completion_tokens: 3,
          total_tokens: 5,
        },
      },
    ]);
  });
});

async function collect(stream: ReadableStream<unknown>) {
  const result: unknown[] = [];
  const reader = stream.getReader();
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      result.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  return result;
}
