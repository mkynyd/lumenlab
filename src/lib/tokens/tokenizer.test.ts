import { describe, it, expect } from "vitest";
import {
  countTokens,
  countMessageTokens,
  estimateMediaTokens,
} from "./tokenizer";
import type { DeepSeekMessage } from "@/lib/deepseek";

describe("tokenizer", () => {
  it("counts tokens for English text", () => {
    const tokens = countTokens("Hello world");
    expect(tokens).toBeGreaterThan(0);
  });

  it("counts tokens for Chinese text", () => {
    const tokens = countTokens("你好，世界");
    expect(tokens).toBeGreaterThan(0);
  });

  it("counts message array tokens greater than text tokens", () => {
    const messages = [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there!" },
    ];
    const tokens = countMessageTokens(messages);
    expect(tokens).toBeGreaterThan(
      messages.reduce((sum, m) => sum + countTokens(m.content), 0)
    );
  });

  it("estimates media tokens", () => {
    expect(estimateMediaTokens(2)).toBe(512);
    expect(estimateMediaTokens(0)).toBe(0);
  });

  it("counts every native tool block and its arguments without altering messages", () => {
    const messages: DeepSeekMessage[] = [{ role: "assistant", content: [
      { type: "text", text: "已整理正文" },
      { type: "tool_use", id: "call-1", name: "artifact_save", input: { content: "思想汇报正文" } },
    ] }, { role: "user", content: [
      { type: "tool_result", tool_use_id: "call-1", content: '{"id":"artifact-1"}' },
    ] }];
    const before = JSON.stringify(messages);
    expect(countMessageTokens(messages)).toBe(countMessageTokens(messages.map((message) => ({
      role: message.role, content: JSON.stringify(message.content),
    }))));
    expect(JSON.stringify(messages)).toBe(before);
  });
});
