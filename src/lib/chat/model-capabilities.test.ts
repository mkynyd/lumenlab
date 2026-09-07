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

  it("allows manual web search on MiniMax through server-side prefetch", () => {
    expect(modelSupportsWebSearch("minimax-m3")).toBe(true);
    expect(effectiveWebSearchActive("minimax-m3", true)).toBe(true);
  });
});
