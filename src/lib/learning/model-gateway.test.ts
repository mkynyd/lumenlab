import { describe, expect, it, vi } from "vitest";

import { createDeepSeekLearningModelGateway } from "./model-gateway";

const source = {
  handle: "source-1",
  fileAssetId: "file-1",
  title: "电路.md",
  content: "节点电流守恒。",
  contentFingerprint: "sha256:v1:source",
};

describe("DeepSeek learning model gateway", () => {
  it("uses the owning user's provider key and parses fenced JSON", async () => {
    const getApiKey = vi.fn().mockResolvedValue("key");
    const createMessage = vi
      .fn()
      .mockResolvedValue(
        '```json\n{"points":[{"stableKey":"kcl","name":"KCL","kind":"concept","order":0,"predecessorStableKeys":[],"sourceHandles":["source-1"]}]}\n```'
      );
    const gateway = createDeepSeekLearningModelGateway({
      getApiKey,
      createMessage,
    });

    await expect(
      gateway.generateKnowledgeMap({
        userId: "user-1",
        goal: { title: "电路" },
        scope: {},
        sources: [source],
      })
    ).resolves.toMatchObject({
      points: [{ stableKey: "kcl", sourceHandles: ["source-1"] }],
    });
    expect(getApiKey).toHaveBeenCalledWith("user-1", "deepseek");
    expect(createMessage).toHaveBeenCalledWith(
      "key",
      expect.objectContaining({
        model: "deepseek-v4-flash",
        prompt: expect.not.stringContaining("user-1"),
      })
    );
  });

  it("fails explicitly instead of silently truncating oversized material", async () => {
    const gateway = createDeepSeekLearningModelGateway({
      getApiKey: vi.fn().mockResolvedValue("key"),
      createMessage: vi.fn(),
    });

    await expect(
      gateway.generatePracticeItems({
        userId: "user-1",
        map: {},
        sources: [{ ...source, content: "x".repeat(300_001) }],
      })
    ).rejects.toMatchObject({
      code: "source_unsupported",
      status: 413,
    });
  });

  it("rejects non-JSON provider output", async () => {
    const gateway = createDeepSeekLearningModelGateway({
      getApiKey: vi.fn().mockResolvedValue("key"),
      createMessage: vi.fn().mockResolvedValue("无法生成"),
    });

    await expect(
      gateway.generateKnowledgeMap({
        userId: "user-1",
        sources: [source],
      })
    ).rejects.toMatchObject({
      code: "invalid_state",
      status: 502,
    });
  });
});
