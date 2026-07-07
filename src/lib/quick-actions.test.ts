import { describe, expect, it } from "vitest";
import { getDefaultQuickActions, MERMAID_LOGIC_PROMPT } from "@/lib/quick-actions";

describe("quick actions", () => {
  it("keeps Mermaid logic prompt anchored with examples and subgraph edge guardrails", () => {
    const mermaidAction = getDefaultQuickActions("review").find(
      (action) => action.title === "生成 Mermaid 逻辑图"
    );

    expect(mermaidAction?.prompt).toBe(MERMAID_LOGIC_PROMPT);
    expect(MERMAID_LOGIC_PROMPT.match(/<example>/g)).toHaveLength(5);
    expect(MERMAID_LOGIC_PROMPT).toContain("禁止把箭头连到 subgraph ID");
    expect(MERMAID_LOGIC_PROMPT).toContain("禁止 A5 --> L2");
    expect(MERMAID_LOGIC_PROMPT).toContain("A5 --> B1");
    expect(MERMAID_LOGIC_PROMPT).toContain("不要输出 classDef");
  });
});
