import { describe, it, expect } from "vitest";
import {
  checkContextBudget,
  CONTEXT_BUDGET,
  WARN_THRESHOLD,
  COMPRESS_THRESHOLD,
} from "./budget";

import { countTokens } from "./tokenizer";
import type { DeepSeekMessage } from "@/lib/deepseek";

function makeMessages(count: number, targetTokensPerMessage: number) {
  // 用中文句子填充，使内容长度与 token 数大致成正比
  const sentence = "这是一段用于测试上下文预算的示例文本，包含多个中文词语。";
  const sentenceTokens = Math.max(1, countTokens(sentence));
  const repeats = Math.ceil(targetTokensPerMessage / sentenceTokens);
  const content = sentence.repeat(repeats);
  return Array.from({ length: count }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content,
  }));
}

describe("budget", () => {
  it("budgets resumed native tool messages without passing content blocks to the text encoder", () => {
    const messages: DeepSeekMessage[] = [
      { role: "user", content: "继续完成思想汇报" },
      { role: "assistant", content: [
        { type: "text", text: "已整理正文" },
        { type: "tool_use", id: "call-1", name: "artifact_save", input: { title: "思想汇报", content: "报告正文" } },
      ] },
      { role: "user", content: [
        { type: "tool_result", tool_use_id: "call-1", content: '{"id":"artifact-1"}' },
      ] },
    ];
    // Matches durable continuationMessages, which used to be cast to string messages.
    const result = checkContextBudget(messages);
    expect(result.status).toBe("ok");
    expect(result.tokens).toBeGreaterThan(checkContextBudget([messages[0]]).tokens);
    expect(checkContextBudget(messages, { budget: 1 }).status).toBe("overflow");
  });

  it("returns ok for small context", () => {
    const result = checkContextBudget([
      { role: "system", content: "You are helpful." },
      { role: "user", content: "Hello" },
    ]);
    expect(result.status).toBe("ok");
    expect(result.tokens).toBeGreaterThan(0);
    expect(result.budget).toBe(CONTEXT_BUDGET);
  });

  it("returns warn when ratio crosses warn threshold", () => {
    const smallBudget = 1000;
    const targetPerMessage = Math.floor((smallBudget * WARN_THRESHOLD - 10) / 2);
    const messages = makeMessages(2, targetPerMessage);
    const result = checkContextBudget(messages, { budget: smallBudget });
    expect(result.status).toBe("warn");
    expect(result.ratio).toBeGreaterThanOrEqual(WARN_THRESHOLD);
    expect(result.budget).toBe(smallBudget);
  });

  it("returns compress when ratio crosses compress threshold", () => {
    const smallBudget = 1000;
    const targetPerMessage = Math.floor((smallBudget * COMPRESS_THRESHOLD - 10) / 2);
    const messages = makeMessages(2, targetPerMessage);
    const result = checkContextBudget(messages, { budget: smallBudget });
    expect(result.status).toBe("compress");
    expect(result.ratio).toBeGreaterThanOrEqual(COMPRESS_THRESHOLD);
  });

  it("returns overflow when exceeding budget", () => {
    const smallBudget = 1000;
    const targetPerMessage = Math.floor(smallBudget / 2) + 200;
    const messages = makeMessages(2, targetPerMessage);
    const result = checkContextBudget(messages, { budget: smallBudget });
    expect(result.status).toBe("overflow");
    expect(result.ratio).toBeGreaterThanOrEqual(1);
  });
});
