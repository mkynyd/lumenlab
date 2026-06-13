import { describe, expect, it } from "vitest";
import { apiKeySchema } from "@/lib/validators";

describe("apiKeySchema", () => {
  it("accepts both supported providers", () => {
    expect(
      apiKeySchema.parse({ provider: "deepseek", key: "sk-deepseek-key" })
    ).toEqual({ provider: "deepseek", key: "sk-deepseek-key" });
    expect(
      apiKeySchema.parse({ provider: "minimax", key: "minimax-key" })
    ).toEqual({ provider: "minimax", key: "minimax-key" });
  });

  it("rejects unknown providers", () => {
    expect(() =>
      apiKeySchema.parse({ provider: "other", key: "secret" })
    ).toThrow();
  });
});
