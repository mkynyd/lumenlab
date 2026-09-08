import { afterEach, describe, expect, it, vi } from "vitest";
import { BailianQwenAdapter } from "./bailian-qwen-adapter";
import { collect, mockSse, params, image } from "./responses-test-helpers";

vi.mock("@/lib/storage/object-storage", () => ({
  uploadObjectBuffer: vi.fn(async () => ({ provider: "qiniu", key: "transient/qwen/test.mp4" })),
  deleteStoredObject: vi.fn(async () => undefined),
  createSignedDownloadUrl: vi.fn(() => "https://media.example.test/short-lived.mp4"),
}));

afterEach(() => vi.unstubAllGlobals());
describe("Qwen Responses adapter", () => {
  it("uses the workspace Responses endpoint and disables remote storage", async () => {
    const { requests } = mockSse();
    const adapter = new BailianQwenAdapter("ba-test", "https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1");
    const round = await adapter.startRound({ ...params, model: "qwen3.8-flash", activeTools: [], attachments: [image] });
    await collect(round.events);
    expect(requests[0].url).toBe("https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/responses");
    expect(requests[0].body).toMatchObject({ model: "qwen3.8-flash", store: false, reasoning: { effort: "high" } });
    expect(requests[0].body).not.toHaveProperty("previous_response_id");
    expect(JSON.stringify(requests[0].body)).toContain("data:image/png;base64,cG5n");
  });
  it.each([
    ["video/mp4", /视频理解请选择 Qwen/],
    ["audio/mpeg", /音频/],
  ] as const)("rejects unsupported %s on the Responses stream path", async (mimeType, pattern) => {
    const { fetchMock } = mockSse();
    const adapter = new BailianQwenAdapter("ba-test", "https://workspace.example/compatible-mode/v1");
    await expect(adapter.stream({ ...params, model: "qwen3.8-flash", attachments: [{ ...image, mimeType }] })).rejects.toThrow(pattern);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Qwen 视频兼容委托", () => {
  it("startRound with a video attachment delegates to the DashScope native endpoint", async () => {
    const native = mockNativeSse();
    vi.stubGlobal("fetch", native.fetchMock);
    const adapter = new BailianQwenAdapter("ba-test", "https://ws.cn-beijing.maas.aliyuncs.com/compatible-mode/v1");
    const round = await adapter.startRound({
      ...params,
      model: "qwen3.8-flash",
      activeTools: [],
      attachments: [{ name: "clip.mp4", mimeType: "video/mp4", size: 3, data: Buffer.from("mp4") }],
    });
    await collect(round.events);
    expect(native.urls[0]).toBe("https://ws.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation");
    expect(native.bodies[0]).toMatchObject({ model: "qwen3.7-plus" });
  });

  it("continueRound stays on the native path while video remains in the transcript", async () => {
    const native = mockNativeSse([
      { output: { choices: [{ message: { content: [{ text: "调用工具" }], tool_calls: [{ id: "call-9", type: "function", function: { name: "web.search", arguments: '{"query":"q"}' } }] } }] } },
      { output: { choices: [{ message: { content: [{ text: "完成" }] } }] } },
    ]);
    vi.stubGlobal("fetch", native.fetchMock);
    const adapter = new BailianQwenAdapter("ba-test", "https://ws.cn-beijing.maas.aliyuncs.com/compatible-mode/v1");
    const videoMessage = {
      role: "user" as const,
      content: "总结视频",
      attachments: [{ name: "clip.mp4", mimeType: "video/mp4", size: 3, data: Buffer.from("mp4") }],
    };
    const first = await adapter.startRound({
      ...params,
      model: "qwen3.8-flash",
      messages: [videoMessage],
      activeTools: [],
      attachments: [],
    });
    await collect(first.events);
    const second = await adapter.continueRound({
      ...params,
      model: "qwen3.8-flash",
      messages: first.requestMessages,
      activeTools: [],
      attachments: [],
      toolCalls: first.getToolCalls(),
      toolResults: [{ toolUseId: "call-9", content: '{"results":[]}' }],
      rawContent: first.getRawContent(),
    });
    await collect(second.events);
    expect(native.urls).toHaveLength(2);
    expect(native.urls[1]).toContain("/services/aigc/multimodal-generation/generation");
    const continuationInput = native.bodies[1].input as { messages: Array<Record<string, unknown>> };
    expect(continuationInput.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "tool", tool_call_id: "call-9" }),
    ]));
  });
});

/** Native DashScope SSE mock: captures URLs and parsed request bodies. */
function mockNativeSse(events: unknown[] = [
  { output: { choices: [{ message: { content: [{ text: "ok" }] } }] } },
]) {
  const urls: string[] = [];
  const bodies: Array<Record<string, unknown>> = [];
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    urls.push(String(url));
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""));
  });
  return { urls, bodies, fetchMock };
}
