import { describe, expect, it } from "vitest";
import {
  availableChatModels,
  isChatModelEnabled,
} from "./model-catalog";

describe("chat model catalog", () => {
  it("keeps Qwen hidden until the server-side rollout flag is enabled", () => {
    expect(availableChatModels("false")).not.toContain("qwen3.7-plus");
    expect(isChatModelEnabled("qwen3.7-plus", "false")).toBe(false);
  });

  it("makes Qwen selectable only for an enabled rollout", () => {
    expect(availableChatModels("true")).toContain("qwen3.7-plus");
    expect(isChatModelEnabled("qwen3.7-plus", "true")).toBe(true);
  });
});
