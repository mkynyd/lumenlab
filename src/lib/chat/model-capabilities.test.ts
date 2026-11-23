import { describe, expect, it } from "vitest";
import {
  effectiveWebSearchActive,
  modelSupportsWebSearch,
} from "@/lib/chat/model-capabilities";

describe("model capabilities", () => {
  it("allows manual web search on DeepSeek models", () => {
    expect(modelSupportsWebSearch("deepseek-v4-pro")).toBe(true);
    expect(effectiveWebSearchActive("deepseek-v4-flash", true)).toBe(true);
  });

  it("allows manual web search on Qwen", () => {
    expect(modelSupportsWebSearch("qwen3.8-flash")).toBe(true);
    expect(effectiveWebSearchActive("qwen3.8-flash", true)).toBe(true);
  });
});
