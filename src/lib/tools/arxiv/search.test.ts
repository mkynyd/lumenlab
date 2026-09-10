import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { arxivSearch } from "./search";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<feed>
  <entry>
    <id>http://arxiv.org/abs/2401.12345v1</id>
    <title>Test Paper Title</title>
    <summary>An abstract about testing.</summary>
    <published>2024-01-15T10:00:00Z</published>
    <author><name>Alice</name></author>
    <author><name>Bob</name></author>
    <link href="http://arxiv.org/abs/2401.12345v1" rel="alternate"/>
    <category term="cs.CL"/>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2402.67890v2</id>
    <title>Second Paper</title>
    <summary>Another abstract.</summary>
    <published>2024-02-20T11:30:00Z</published>
    <author><name>Carol</name></author>
    <link href="http://arxiv.org/abs/2402.67890v2" rel="alternate"/>
    <category term="cs.LG"/>
  </entry>
</feed>`;

describe("arxiv.search", () => {
  it("parses XML response into structured results", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(SAMPLE_XML),
    });
    const result = await arxivSearch("test paper", 3);
    expect(result.error).toBeUndefined();
    expect(result.count).toBe(2);
    const entries = result.results as Array<{
      arxivId: string;
      title: string;
      authors: string[];
      year: number;
    }>;
    expect(entries[0].arxivId).toBe("2401.12345v1");
    expect(entries[0].title).toBe("Test Paper Title");
    expect(entries[0].authors).toEqual(["Alice", "Bob"]);
    expect(entries[0].year).toBe(2024);
  });

  it("returns EMPTY_QUERY for blank input", async () => {
    const result = await arxivSearch("   ", 5);
    expect(result.error).toBe("EMPTY_QUERY");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns ARXIV_FAILED when status != 200", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    const result = await arxivSearch("foo");
    expect(result.error).toBe("ARXIV_FAILED");
  });

  it("returns FETCH_ERROR on network failure", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const result = await arxivSearch("foo");
    expect(result.error).toBe("FETCH_ERROR");
  });

  it("retries a network failure exactly once with bounded backoff", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNRESET"));
    const startedAt = Date.now();
    const result = await arxivSearch("foo");
    expect(result.error).toBe("FETCH_ERROR");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(Date.now() - startedAt).toBeLessThan(5000);
  });

  it("succeeds when the single retry recovers", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(SAMPLE_XML) });
    const result = await arxivSearch("test paper", 2);
    expect(result.error).toBeUndefined();
    expect(result.count).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never retries when the parent abort signal cancelled the call", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(() => {
      controller.abort();
      return Promise.reject(new DOMException("The operation was aborted.", "AbortError"));
    });
    const result = await arxivSearch("foo", 5, { signal: controller.signal });
    expect(result.error).toBe("FETCH_ERROR");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("passes the parent signal through to fetch", async () => {
    fetchMock.mockResolvedValue({ ok: true, text: () => Promise.resolve(SAMPLE_XML) });
    const controller = new AbortController();
    await arxivSearch("foo", 5, { signal: controller.signal });
    const usedSignal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    controller.abort();
    expect(usedSignal.aborted).toBe(true);
  });
});