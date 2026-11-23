import { describe, expect, it } from "vitest";
import {
  buildCacheExperiments,
  getActiveExperiments,
} from "@/lib/cache/experiment-config";
import { reorderMessagesForCache } from "@/lib/cache/prompt-reorder";

describe("cache experiments", () => {
  it("defaults every experiment to disabled", () => {
    const config = buildCacheExperiments({});
    expect(config.adaptivePromptOrdering.enabled).toBe(false);
    expect(getActiveExperiments(config)).toEqual([]);
  });

  it("leaves requests byte-for-byte unchanged while disabled", () => {
    const config = buildCacheExperiments({});
    const messages = [{ role: "user", content: "hello" }] as const;

    expect(
      reorderMessagesForCache(
        [...messages],
        "stable",
        "rag",
        config.adaptivePromptOrdering
      )
    ).toEqual(messages);
  });
});
