import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createProviderAdapter,
  resolveProviderAdapterLayer,
} from "./index";
import { DeepSeekAdapter } from "./deepseek-adapter";
import { BailianQwenAdapter } from "./bailian-qwen-adapter";

afterEach(() => vi.unstubAllEnvs());

describe("createProviderAdapter", () => {
  it.each(["deepseek", "minimax", "bailian"] as const)("can pause %s without falling back to an unverified protocol", (provider) => {
    vi.stubEnv(`AGENT_RESPONSES_${provider.toUpperCase()}_ENABLED`, "false");
    expect(() => createProviderAdapter(provider, "test", "responses")).toThrow(/暂停服务/);
  });
  it("keeps legacy as an alias for the project Responses adapter", () => {
    expect(createProviderAdapter("deepseek", "sk-test", "legacy")).toBeInstanceOf(
      DeepSeekAdapter
    );
  });

  it("prevents the old Pi POC from bypassing the active Responses model configuration", () => {
    expect(() => createProviderAdapter("minimax", "sk-test", "pi")).toThrow(/旧 Pi 协议/);
    expect(resolveProviderAdapterLayer("pi")).toBe("pi");
    expect(resolveProviderAdapterLayer("pi-ai")).toBe("pi");
    expect(resolveProviderAdapterLayer("anything-else")).toBe("responses");
  });

  it("always selects the Responses adapter for Qwen", () => {
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
