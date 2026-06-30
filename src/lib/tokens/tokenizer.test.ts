import { describe, it, expect } from "vitest";
import {
  countTokens,
  countMessageTokens,
  estimateMediaTokens,
} from "./tokenizer";

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
});
