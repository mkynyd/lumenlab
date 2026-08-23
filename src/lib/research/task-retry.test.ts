import { describe, expect, it } from "vitest";
import { nextResearchTaskRetryStatus } from "./task-retry";

describe("research task retry", () => {
  it("keeps a bounded retry before terminal failure", () => {
    expect(nextResearchTaskRetryStatus(1, 2)).toBe("retrying");
    expect(nextResearchTaskRetryStatus(2, 2)).toBe("failed");
  });
});
