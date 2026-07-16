import { describe, expect, it } from "vitest";
import {
  createProviderAdapter,
  resolveProviderAdapterLayer,
} from "./index";
import { DeepSeekAdapter } from "./deepseek-adapter";
import { PiAiAdapter } from "./pi-ai-adapter";
import { BailianQwenAdapter } from "./bailian-qwen-adapter";

describe("createProviderAdapter", () => {
  it("keeps the legacy adapter as the default layer", () => {
    expect(createProviderAdapter("deepseek", "sk-test", "legacy")).toBeInstanceOf(
      DeepSeekAdapter
    );
  });

  it("selects the isolated pi POC only when explicitly requested", () => {
    expect(createProviderAdapter("minimax", "sk-test", "pi")).toBeInstanceOf(
      PiAiAdapter
    );
    expect(resolveProviderAdapterLayer("pi")).toBe("pi");
    expect(resolveProviderAdapterLayer("pi-ai")).toBe("pi");
    expect(resolveProviderAdapterLayer("anything-else")).toBe("legacy");
  });

  it("always selects the DashScope-native adapter for Qwen", () => {
    const previous = process.env.BAILIAN_WORKSPACE_ID;
    process.env.BAILIAN_WORKSPACE_ID = "workspace-for-test";
    try {
      expect(createProviderAdapter("bailian", "ba-test", "legacy")).toBeInstanceOf(
        BailianQwenAdapter
      );
    } finally {
      if (previous === undefined) delete process.env.BAILIAN_WORKSPACE_ID;
      else process.env.BAILIAN_WORKSPACE_ID = previous;
    }
  });
});
