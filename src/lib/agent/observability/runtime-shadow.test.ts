import { describe, expect, it } from "vitest";
import { compareRuntimeDecisions } from "./runtime-shadow";

describe("compareRuntimeDecisions", () => {
  it("reports only changed planning dimensions", () => {
    const comparison = compareRuntimeDecisions({
      legacy: {
        skillId: null,
        webSearchActive: false,
        plannedToolIds: [],
      },
      candidate: {
        skillId: "paper-writer",
        webSearchActive: false,
        plannedToolIds: ["project_rag.search"],
      },
    });

    expect(comparison.changed).toBe(true);
    expect(comparison.differences).toEqual(["skillId", "plannedToolIds"]);
  });
});
