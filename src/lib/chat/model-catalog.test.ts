import { describe, expect, it } from "vitest";
import {
  ALL_CHAT_MODELS,
  DEFAULT_CHAT_MODELS,
  LEGACY_CHAT_MODELS,
  MODEL_CATALOG,
  MODEL_CATALOG_ENTRIES,
  MODEL_BILLING_VERSION,
  QWEN_CHAT_MODEL,
  activeModelForStoredModel,
  availableChatModels,
  chatModelLabel,
  getModelCatalogEntry,
  isActiveChatModel,
  isChatModelEnabled,
  isKnownChatModel,
  providerForChatModel,
} from "./model-catalog";

describe("chat model catalog", () => {
  it("keeps Qwen hidden until the server-side rollout flag is enabled", () => {
    expect(availableChatModels("false")).not.toContain("qwen3.8-flash");
    expect(isChatModelEnabled("qwen3.8-flash", "false")).toBe(false);
  });

  it("makes Qwen selectable only for an enabled rollout", () => {
    expect(availableChatModels("true")).toContain("qwen3.8-flash");
    expect(isChatModelEnabled("qwen3.8-flash", "true")).toBe(true);
  });

  it("activates exactly the three migration target models", () => {
    expect(DEFAULT_CHAT_MODELS).toEqual([
      "deepseek-v4-flash-vision-exp",
      "minimax-m3",
    ]);
    expect(QWEN_CHAT_MODEL).toBe("qwen3.8-flash");
    expect(ALL_CHAT_MODELS).toEqual([
      "deepseek-v4-flash-vision-exp",
      "minimax-m3",
      "qwen3.8-flash",
    ]);
  });

  it("keeps historical aliases mapped but disabled for new requests", () => {
    expect(LEGACY_CHAT_MODELS).toEqual([
      "deepseek-v4-flash",
      "deepseek-v4-pro",
      "qwen3.7-plus",
    ]);
    for (const legacy of LEGACY_CHAT_MODELS) {
      expect(isKnownChatModel(legacy)).toBe(true);
      expect(isActiveChatModel(legacy)).toBe(false);
      // 历史别名即使打开 Qwen 灰度开关也不能用于新请求
      expect(isChatModelEnabled(legacy, "true")).toBe(false);
    }
  });

  it("keeps the id arrays and catalog entries consistent", () => {
    const enabledIds = MODEL_CATALOG_ENTRIES.filter((e) => e.enabled).map(
      (e) => e.id
    );
    const legacyIds = MODEL_CATALOG_ENTRIES.filter((e) => !e.enabled).map(
      (e) => e.id
    );
    expect(enabledIds).toEqual([...ALL_CHAT_MODELS]);
    expect(legacyIds).toEqual([...LEGACY_CHAT_MODELS]);
    for (const entry of MODEL_CATALOG_ENTRIES) {
      expect(MODEL_CATALOG[entry.id as keyof typeof MODEL_CATALOG]).toBe(entry);
    }
  });

  it("describes active models with wire IDs, modalities, limits and reasoning mapping", () => {
    expect(getModelCatalogEntry("deepseek-v4-flash-vision-exp")).toMatchObject({
      wireId: "deepseek-v4-flash-vision-exp",
      provider: "deepseek",
      inputTypes: ["text", "image"],
      contextWindowTokens: 1_000_000,
      maxOutputTokens: 384_000,
      reasoningEffort: { high: "high", max: "max" },
      enabled: true,
      billingVersion: MODEL_BILLING_VERSION,
    });
    expect(getModelCatalogEntry("minimax-m3")).toMatchObject({
      wireId: "MiniMax-M3",
      provider: "minimax",
      inputTypes: ["text", "image"],
      reasoningEffort: { high: "medium", max: "high" },
      enabled: true,
    });
    expect(getModelCatalogEntry("qwen3.8-flash")).toMatchObject({
      wireId: "qwen3.8-flash",
      provider: "bailian",
      inputTypes: ["text", "image"],
      reasoningEffort: { high: "medium", max: "high" },
      enabled: true,
    });
  });

  it("resolves providers for both active and legacy models", () => {
    expect(providerForChatModel("deepseek-v4-flash-vision-exp")).toBe("deepseek");
    expect(providerForChatModel("minimax-m3")).toBe("minimax");
    expect(providerForChatModel("qwen3.8-flash")).toBe("bailian");
    expect(providerForChatModel("deepseek-v4-flash")).toBe("deepseek");
    expect(providerForChatModel("deepseek-v4-pro")).toBe("deepseek");
    expect(providerForChatModel("qwen3.7-plus")).toBe("bailian");
    expect(providerForChatModel("unknown-model")).toBeUndefined();
  });

  it("upgrades stored legacy IDs only when starting a new request", () => {
    expect(activeModelForStoredModel("deepseek-v4-flash")).toBe(
      "deepseek-v4-flash-vision-exp"
    );
    expect(activeModelForStoredModel("deepseek-v4-pro")).toBe(
      "deepseek-v4-flash-vision-exp"
    );
    expect(activeModelForStoredModel("qwen3.7-plus")).toBe("qwen3.8-flash");
    expect(activeModelForStoredModel("minimax-m3")).toBe("minimax-m3");
  });

  it("keeps display labels for historical aliases and falls back to the raw id", () => {
    expect(chatModelLabel("deepseek-v4-flash")).toBe("DeepSeek V4 Flash");
    expect(chatModelLabel("deepseek-v4-pro")).toBe("DeepSeek V4 Pro");
    expect(chatModelLabel("qwen3.7-plus")).toBe("Qwen3.7-Plus");
    // 列表标签保持简短（Vision 属性移到详情栏），历史别名标签不变
    expect(chatModelLabel("deepseek-v4-flash-vision-exp")).toBe(
      "DeepSeek V4 Flash"
    );
    expect(chatModelLabel("qwen3.8-flash")).toBe("Qwen3.8-Flash");
    expect(chatModelLabel("some-old-model")).toBe("some-old-model");
  });
});
