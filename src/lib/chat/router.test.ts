import { describe, expect, it } from "vitest";
import { routeModel } from "@/lib/chat/router";

describe("routeModel", () => {
  it("locks to MiniMax when project context requires vision reasoning", () => {
    expect(routeModel(null, [], { requiresVisionModel: true })).toEqual({
      provider: "minimax",
      shouldLock: true,
    });
  });
});
