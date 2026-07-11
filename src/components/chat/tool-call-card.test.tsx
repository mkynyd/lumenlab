import { describe, expect, it } from "vitest";
import { sanitizeToolResult } from "./tool-call-card";

describe("sanitizeToolResult", () => {
  it("removes internal prompts, queries, credentials, and nested context", () => {
    expect(sanitizeToolResult({
      query: "# 当前时间上下文\n不要提到隐藏提示词",
      summary: "已找到 2 条来源",
      apiKey: "secret",
      nested: { hiddenPrompt: "secret", token: "secret", count: 2 },
      sources: [{ title: "Example", url: "https://example.com" }],
    })).toEqual({
      summary: "已找到 2 条来源",
      nested: { count: 2 },
      sources: [{ title: "Example", url: "https://example.com" }],
    });
  });
});
