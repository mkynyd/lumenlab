import { afterEach, describe, expect, it, vi } from "vitest";
import { BailianQwenAdapter } from "./bailian-qwen-adapter";
import { collect, mockSse, params, image } from "./responses-test-helpers";
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
  it.each(["video/mp4", "audio/mpeg"])("rejects unsupported %s before any upstream call", async (mimeType) => {
    const { fetchMock } = mockSse();
    const adapter = new BailianQwenAdapter("ba-test", "https://workspace.example/compatible-mode/v1");
    await expect(adapter.stream({ ...params, model: "qwen3.8-flash", attachments: [{ ...image, mimeType }] })).rejects.toThrow(/视频或音频/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
