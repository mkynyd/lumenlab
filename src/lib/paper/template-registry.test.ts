import { describe, expect, it } from "vitest";
import { mapTemplateRuntimeStatus, parseTemplateRegistry } from "./template-registry";

describe("template registry", () => {
  it("keeps recommendation and runtime status separate", () => {
    const [record] = parseTemplateRegistry([{ id: "x", university: "A", format: "latex", status: "stale", recommendationLevel: "A" }]);
    expect(record.recommendationLevel).toBe("A");
    expect(mapTemplateRuntimeStatus(record)).toBe("Needs Review");
  });
});
