import { describe, expect, it } from "vitest";
import { mapDeepSeekModel } from "@/lib/deepseek";

describe("mapDeepSeekModel", () => {
  it("maps UI model ids to DeepSeek Anthropic aliases", () => {
    expect(mapDeepSeekModel("deepseek-v4-pro")).toBe("claude-opus-4-8");
    expect(mapDeepSeekModel("deepseek-v4-flash")).toBe("claude-sonnet-4-6");
  });
});
