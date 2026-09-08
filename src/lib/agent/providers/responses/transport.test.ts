import { describe, expect, it } from "vitest";
import {
  postResponses,
  streamResponses,
  ResponsesHttpError,
  ResponsesStreamInterruptedError,
  ResponsesTimeoutError,
} from "./transport";
import type { ResponsesStreamEvent } from "./types";

interface FakeCall {
  url: string;
  init: RequestInit;
}

function fakeFetch(
  handler: (url: string, init: RequestInit) => Promise<Response> | Response
) {
  const calls: FakeCall[] = [];
  const impl = (async (url: unknown, init?: RequestInit) => {
    const request = init ?? {};
    calls.push({ url: String(url), init: request });
    return handler(String(url), request);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function sseResponse(chunks: Array<string | Uint8Array>) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(
          typeof chunk === "string" ? encoder.encode(chunk) : chunk
        );
      }
      controller.close();
    },
  });
  return { ok: true, status: 200, body } as unknown as Response;
}

function errorResponse(
  status: number,
  body: string,
  headers: Record<string, string> = {}
) {
  return {
    ok: false,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

async function collect(source: AsyncIterable<ResponsesStreamEvent>) {
  const events: ResponsesStreamEvent[] = [];
  for await (const event of source) events.push(event);
  return events;
}

function sseEvent(payload: Record<string, unknown>) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

describe("streamResponses", () => {
  it("POSTs {baseUrl}/responses with bearer auth and a forced stream flag", async () => {
    const { impl, calls } = fakeFetch(() =>
      sseResponse([
        sseEvent({
          type: "response.completed",
          response: { id: "r1", status: "completed" },
        }),
      ])
    );
    const events = await collect(
      await streamResponses({
        baseUrl: "https://api.example.com/",
        apiKey: "sk-test",
        body: { model: "m", input: [] },
        fetchImpl: impl,
      })
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.example.com/responses");
    expect(calls[0]!.init.method).toBe("POST");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-test");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      model: "m",
      input: [],
      stream: true,
    });
    expect(events.map((event) => event.type)).toEqual(["response.completed"]);
  });

  it("buffers half lines across chunks, including multi-byte characters", async () => {
    const bytes = new TextEncoder().encode(
      sseEvent({ type: "response.output_text.delta", delta: "你好" })
    );
    // Split inside the JSON and inside the multi-byte character.
    const cut = bytes.length - 8;
    const { impl } = fakeFetch(() =>
      sseResponse([bytes.slice(0, cut), bytes.slice(cut)])
    );
    const events = await collect(
      await streamResponses({
        baseUrl: "https://api.example.com",
        apiKey: "k",
        body: { model: "m", input: [] },
        fetchImpl: impl,
      })
    );
    expect(events).toEqual([
      { type: "response.output_text.delta", delta: "你好" },
    ]);
  });

  it("joins multiple data lines of one event with newlines", async () => {
    const { impl } = fakeFetch(() =>
      sseResponse([
        'data: {"type":"response.output_text.delta",\ndata: "delta":"x"}\n\n',
      ])
    );
    const events = await collect(
      await streamResponses({
        baseUrl: "https://api.example.com",
        apiKey: "k",
        body: { model: "m", input: [] },
        fetchImpl: impl,
      })
    );
    expect(events).toEqual([
      { type: "response.output_text.delta", delta: "x" },
    ]);
  });

  it("ignores comments, event: lines, and a stray [DONE] sentinel", async () => {
    const { impl } = fakeFetch(() =>
      sseResponse([
        ": heartbeat\n\nevent: response.output_text.delta\n" +
          sseEvent({ type: "response.output_text.delta", delta: "a" }) +
          "data: [DONE]\n\n",
      ])
    );
    const events = await collect(
      await streamResponses({
        baseUrl: "https://api.example.com",
        apiKey: "k",
        body: { model: "m", input: [] },
        fetchImpl: impl,
      })
    );
    expect(events.map((event) => event.type)).toEqual([
      "response.output_text.delta",
    ]);
  });

  it("flushes a final event whose terminating blank line never arrives", async () => {
    const { impl } = fakeFetch(() =>
      sseResponse([
        sseEvent({ type: "response.output_text.delta", delta: "a" }),
        'data: {"type":"response.completed","response":{"status":"completed"}}',
      ])
    );
    const events = await collect(
      await streamResponses({
        baseUrl: "https://api.example.com",
        apiKey: "k",
        body: { model: "m", input: [] },
        fetchImpl: impl,
      })
    );
    expect(events.map((event) => event.type)).toEqual([
      "response.output_text.delta",
      "response.completed",
    ]);
  });

  it("skips malformed data lines without failing the stream", async () => {
    const { impl } = fakeFetch(() =>
      sseResponse([
        "data: {not json\n\n" +
          sseEvent({ type: "response.output_text.delta", delta: "ok" }),
      ])
    );
    const events = await collect(
      await streamResponses({
        baseUrl: "https://api.example.com",
        apiKey: "k",
        body: { model: "m", input: [] },
        fetchImpl: impl,
      })
    );
    expect(events).toEqual([
      { type: "response.output_text.delta", delta: "ok" },
    ]);
  });

  it("maps HTTP 429 to a retryable ResponsesHttpError with retry-after", async () => {
    const { impl } = fakeFetch(() =>
      errorResponse(429, '{"error":{"message":"slow down"}}', {
        "retry-after": "2",
      })
    );
    const failure = await streamResponses({
      baseUrl: "https://api.example.com",
      apiKey: "k",
      body: { model: "m", input: [] },
      fetchImpl: impl,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ResponsesHttpError);
    const httpError = failure as ResponsesHttpError;
    expect(httpError.status).toBe(429);
    expect(httpError.retryable).toBe(true);
    expect(httpError.retryAfterMs).toBe(2000);
    expect(httpError.body).toContain("slow down");
  });

  it("maps HTTP 400 to a non-retryable ResponsesHttpError", async () => {
    const { impl } = fakeFetch(() => errorResponse(400, "bad request"));
    const failure = await streamResponses({
      baseUrl: "https://api.example.com",
      apiKey: "k",
      body: { model: "m", input: [] },
      fetchImpl: impl,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ResponsesHttpError);
    expect((failure as ResponsesHttpError).retryable).toBe(false);
  });

  it("rejects immediately when the caller signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const { impl } = fakeFetch(() => {
      throw new DOMException("The operation was aborted", "AbortError");
    });
    const failure = await streamResponses({
      baseUrl: "https://api.example.com",
      apiKey: "k",
      body: { model: "m", input: [] },
      signal: controller.signal,
      fetchImpl: impl,
    }).catch((error: unknown) => error);
    expect((failure as Error).name).toBe("AbortError");
  });

  it("propagates caller cancellation mid-stream as AbortError", async () => {
    const controller = new AbortController();
    const encoder = new TextEncoder();
    const { impl } = fakeFetch((_url, init) => {
      const body = new ReadableStream<Uint8Array>({
        start(streamController) {
          streamController.enqueue(
            encoder.encode(
              sseEvent({ type: "response.output_text.delta", delta: "a" })
            )
          );
        },
        pull() {
          return new Promise((_, reject) => {
            init.signal?.addEventListener(
              "abort",
              () =>
                reject(
                  init.signal?.reason instanceof Error
                    ? init.signal.reason
                    : new DOMException("The operation was aborted", "AbortError")
                ),
              { once: true }
            );
          });
        },
      });
      return { ok: true, status: 200, body } as unknown as Response;
    });
    const source = await streamResponses({
      baseUrl: "https://api.example.com",
      apiKey: "k",
      body: { model: "m", input: [] },
      signal: controller.signal,
      fetchImpl: impl,
    });
    const reading = collect(source).then(
      () => null,
      (error: unknown) => error
    );
    controller.abort();
    const failure = await reading;
    expect((failure as Error).name).toBe("AbortError");
  });

  it("distinguishes network interruption from clean EOF", async () => {
    const { impl } = fakeFetch(() => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              sseEvent({ type: "response.output_text.delta", delta: "a" })
            )
          );
          controller.error(new Error("socket hangup"));
        },
      });
      return { ok: true, status: 200, body } as unknown as Response;
    });
    const source = await streamResponses({
      baseUrl: "https://api.example.com",
      apiKey: "k",
      body: { model: "m", input: [] },
      fetchImpl: impl,
    });
    const failure = await collect(source).then(
      () => null,
      (error: unknown) => error
    );
    expect(failure).toBeInstanceOf(ResponsesStreamInterruptedError);
    expect((failure as ResponsesStreamInterruptedError).reason).toBe("network");
  });

  it("turns the request timeout into ResponsesTimeoutError", async () => {
    const { impl } = fakeFetch((_url, init) => {
      const body = new ReadableStream<Uint8Array>({
        pull() {
          return new Promise((_, reject) => {
            init.signal?.addEventListener(
              "abort",
              () =>
                reject(
                  init.signal?.reason instanceof Error
                    ? init.signal.reason
                    : new DOMException("The operation was aborted", "AbortError")
                ),
              { once: true }
            );
          });
        },
      });
      return { ok: true, status: 200, body } as unknown as Response;
    });
    const source = await streamResponses({
      baseUrl: "https://api.example.com",
      apiKey: "k",
      body: { model: "m", input: [] },
      timeoutMs: 10,
      fetchImpl: impl,
    });
    const failure = await collect(source).then(
      () => null,
      (error: unknown) => error
    );
    expect(failure).toBeInstanceOf(ResponsesTimeoutError);
  });
});

describe("postResponses", () => {
  it("forces stream:false and returns the parsed payload", async () => {
    const { impl, calls } = fakeFetch(() => {
      return {
        ok: true,
        status: 200,
        text: () =>
          Promise.resolve(
            JSON.stringify({ id: "r1", status: "completed", output_text: "hi" })
          ),
      } as unknown as Response;
    });
    const payload = await postResponses({
      baseUrl: "https://api.example.com",
      apiKey: "k",
      body: { model: "m", input: [] },
      fetchImpl: impl,
    });
    expect(payload.output_text).toBe("hi");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      model: "m",
      input: [],
      stream: false,
    });
  });

  it("maps HTTP errors the same way as the streaming path", async () => {
    const { impl } = fakeFetch(() => errorResponse(500, "boom"));
    const failure = await postResponses({
      baseUrl: "https://api.example.com",
      apiKey: "k",
      body: { model: "m", input: [] },
      fetchImpl: impl,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ResponsesHttpError);
    expect((failure as ResponsesHttpError).status).toBe(500);
    expect((failure as ResponsesHttpError).retryable).toBe(true);
  });
});
