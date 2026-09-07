import { describe, expect, it } from "vitest";
import { routeModel } from "@/lib/chat/router";

describe("routeModel", () => {
  it("locks to MiniMax when project context requires vision reasoning", () => {
    expect(routeModel(null, [], { requiresVisionModel: true })).toEqual({
      provider: "minimax",
      shouldLock: true,
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
