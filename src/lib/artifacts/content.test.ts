import { describe, expect, it } from "vitest";
import {
  containsToolCallMarkup,
  isArtifactContentSavable,
  stripToolCallMarkup,
  suggestArtifactTitle,
} from "@/lib/artifacts/content";

describe("artifact content helpers", () => {
  it("rejects skill activation tool-call preambles", () => {
    const content = `好的，我们先启动论文写作助手来规划这份提纲。

<tool_calls> <invoke name="activate_skill"> <parameter name="name">paper-writer</parameter> </invoke> </tool_calls>`;

    expect(containsToolCallMarkup(content)).toBe(true);
    expect(stripToolCallMarkup(content)).toBe(
      "好的，我们先启动论文写作助手来规划这份提纲。"
    );
    expect(isArtifactContentSavable(content)).toBe(false);
  });

  it("accepts substantive generated markdown and uses headings as titles", () => {
    const content = `# 等级保护论文提纲

## 摘要

本文围绕等级保护制度的演进、技术控制和治理流程展开，结合项目资料梳理网络安全建设路径。`;

    expect(isArtifactContentSavable(content)).toBe(true);
    expect(suggestArtifactTitle(content)).toBe("等级保护论文提纲");
  });
});
