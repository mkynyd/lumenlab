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

  it("keeps an explicitly selected Qwen model for multimodal attachments and follow-up turns", () => {
    const image = { name: "diagram.png", mimeType: "image/png" };

    expect(routeModel(null, [image], { requestedModel: "qwen3.7-plus" })).toEqual({
      provider: "bailian",
      shouldLock: true,
    });
    expect(
      routeModel({ modelLock: "qwen" }, [], { requestedModel: "deepseek-v4-pro" })
    ).toEqual({
      provider: "bailian",
      shouldLock: false,
    });
  });
});
