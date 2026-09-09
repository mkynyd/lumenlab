// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { SciverseError } from "./errors";
import { requestSciverse, resolveSciverseBaseUrl, SCIVERSE_DEFAULT_BASE_URL } from "./transport";

const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

afterEach(() => {
  delete process.env.SCIVERSE_API_BASE_URL;
});

describe("Sciverse base URL", () => {
  it("defaults to the production endpoint and honours explicit override then env", () => {
    delete process.env.SCIVERSE_API_BASE_URL;
    expect(resolveSciverseBaseUrl()).toBe(SCIVERSE_DEFAULT_BASE_URL);
    process.env.SCIVERSE_API_BASE_URL = "https://api-dev.sciverse.space/";
    expect(resolveSciverseBaseUrl()).toBe("https://api-dev.sciverse.space");
    expect(resolveSciverseBaseUrl("https://example.test")).toBe("https://example.test");
  });
});

describe("Sciverse transport", () => {
  it("sends the Bearer token, JSON content type, and query parameters", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const result = await requestSciverse<{ ok: boolean }>({
      method: "POST",
      path: "/meta-search",
      body: { collection: "papers", page: 1 },
      query: { verbose: true },
      token: "scv_test_token",
      fetchImpl,
    });
    expect(result).toEqual({ ok: true });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.sciverse.space/meta-search?verbose=true");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer scv_test_token");
    expect(headers["content-type"]).toBe("application/json");
    expect(JSON.parse(String(init.body))).toEqual({ collection: "papers", page: 1 });
  });

  it("sends GET requests with query params and no JSON body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ text: "abc" }));
    await requestSciverse({
      method: "GET",
      path: "/content",
      query: { doc_id: "deadbeef", offset: 0, limit: 1200 },
      token: "k",
      fetchImpl,
    });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.sciverse.space/content?doc_id=deadbeef&offset=0&limit=1200");
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>)["content-type"]).toBeUndefined();
  });

  it.each([[400, "request"], [401, "auth"], [403, "auth"], [404, "not_found"]] as const)(
    "maps HTTP %i to %s without retrying",
    async (status, kind) => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ code: "X", message: "m", request_id: "req-1" }, status));
      await expect(requestSciverse({ method: "GET", path: "/content", token: "k", fetchImpl })).rejects.toMatchObject({
        kind,
        status,
        code: "X",
        requestId: "req-1",
      });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  );

  it("does not retry 429 and surfaces retryAfterMs from the Retry-After header", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ code: "RATE_LIMITED", message: "slow down" }, 429, { "retry-after": "7" })
    );
    await expect(requestSciverse({ method: "POST", path: "/meta-search", token: "k", fetchImpl })).rejects.toMatchObject({
      kind: "rate_limit",
      status: 429,
      retryAfterMs: 7_000,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reads retry_after from the error details when no header is present", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ code: "RATE_LIMITED", message: "quota", details: { retry_after: 3 } }, 429)
    );
    await expect(requestSciverse({ method: "POST", path: "/meta-search", token: "k", fetchImpl })).rejects.toMatchObject({
      kind: "rate_limit",
      retryAfterMs: 3_000,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([500, 502, 503, 504, 507])("retries HTTP %i exactly once and then fails", async (status) => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ code: "BOOM", message: "x" }, status));
      const promise = requestSciverse({ method: "POST", path: "/meta-search", token: "k", fetchImpl }).catch((e) => e);
      await vi.advanceTimersByTimeAsync(1_000);
      const error = await promise;
      expect(error).toMatchObject({ kind: "server", status });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries a transient 503 once and succeeds on the second attempt", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn()
        .mockResolvedValueOnce(jsonResponse({ code: "BOOM", message: "x" }, 503))
        .mockResolvedValueOnce(jsonResponse({ results: [], total_count: 0 }));
      const promise = requestSciverse({ method: "POST", path: "/meta-search", token: "k", fetchImpl });
      await vi.advanceTimersByTimeAsync(1_000);
      const result = await promise;
      expect(result).toEqual({ results: [], total_count: 0 });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries a network failure once and never loops", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
      const promise = requestSciverse({ method: "POST", path: "/meta-search", token: "k", fetchImpl }).catch((e) => e);
      await vi.advanceTimersByTimeAsync(1_000);
      const error = await promise;
      expect(error).toMatchObject({ kind: "network", status: null });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("maps unparseable success bodies to a response failure", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("not json", { status: 200 }));
    await expect(requestSciverse({ method: "GET", path: "/content", token: "k", fetchImpl })).rejects.toMatchObject({
      kind: "response",
      status: 200,
    });
  });

  it("never leaks the token into error objects or messages", async () => {
    const token = "scv_super_secret_token";
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ code: "X", message: "m" }, 500));
    vi.useFakeTimers();
    try {
      const promise = requestSciverse({ method: "POST", path: "/meta-search", token, fetchImpl }).catch((e) => e);
      await vi.advanceTimersByTimeAsync(1_000);
      const error = (await promise) as SciverseError;
      expect(error).toBeInstanceOf(SciverseError);
      expect(JSON.stringify(error)).not.toContain(token);
      expect(error.message).not.toContain(token);
    } finally {
      vi.useRealTimers();
    }
  });
});
