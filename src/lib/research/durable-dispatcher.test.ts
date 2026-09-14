import { describe, expect, it } from "vitest";
import { buildResearchCheckpoint } from "./durable-dispatcher";

describe("Research durable Skill isolation", () => {
  it("keeps structured Research skillOff with no user-facing Skill identity", () => {
    const checkpoint = buildResearchCheckpoint({
      runId: "run-1",
      question: "研究问题",
      stage: "planning",
      selection: { role: "research.worker", provider: "deepseek", model: "deepseek-flash", reasoningEffort: "high", source: "default" },
    });
    expect(checkpoint.request?.skillOff).toBe(true);
    expect(checkpoint.skill).toEqual({ id: null, version: null });
    expect(checkpoint.allowedToolIds).toEqual(expect.arrayContaining(["web.search", "sciverse.search"]));
    expect(checkpoint.request).not.toHaveProperty("skillId");
  });
});
