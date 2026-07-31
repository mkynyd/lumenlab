import { describe, expect, it } from "vitest";

import * as fixtures from "@/components/learning/__fixtures__/learning-fixtures";
import { expectNoSensitiveFields } from "@/components/learning/__fixtures__/learning-fixtures";

describe("learning fixtures hygiene", () => {
  it("no exported fixture carries pre-submit sensitive fields", () => {
    const fixtureEntries = Object.entries(fixtures).filter(
      ([name, value]) =>
        name.startsWith("fixture") &&
        typeof value === "object" &&
        value !== null
    );
    expect(fixtureEntries.length).toBeGreaterThan(0);
    for (const [name, value] of fixtureEntries) {
      expect(
        () => expectNoSensitiveFields(value),
        `fixture ${name} must not contain answerCriteria or generationMetadata`
      ).not.toThrow();
    }
  });
});
