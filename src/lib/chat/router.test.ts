import { describe, expect, it } from "vitest";
import { routeModel } from "@/lib/chat/router";

describe("routeModel", () => {
  it("no longer force-locks a provider for vision-requiring attachments", () => {
    // 任务 05：图片能力通用，无显式选择时不写锁，默认 DeepSeek Vision。
    expect(routeModel(null, [{ name: "photo.png", mimeType: "image/png" }])).toEqual({
      provider: "deepseek",
      shouldLock: false,
    });
  });

  it("routes to MiniMax when the user explicitly selects MiniMax M3 without forcing a lock", () => {
    expect(routeModel(null, [], { requestedModel: "minimax-m3" })).toEqual({
      provider: "minimax",
      shouldLock: false,
    });
  });

  it("keeps every explicitly selected model for multimodal attachments", () => {
    const image = { name: "diagram.png", mimeType: "image/png" };

    expect(routeModel(null, [image], { requestedModel: "qwen3.8-flash" })).toEqual({
      provider: "bailian",
      shouldLock: false,
    });
    expect(
      routeModel(
        { modelLock: "qwen" },
        [image],
        { requestedModel: "deepseek-v4-flash-vision-exp" }
      )
    ).toEqual({
      provider: "deepseek",
      shouldLock: false,
    });
  });
});
