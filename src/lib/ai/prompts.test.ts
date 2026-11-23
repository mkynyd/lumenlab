import { describe, expect, it } from "vitest";

import { GLOBAL_SYSTEM_PROMPT, GLOBAL_SYSTEM_PROMPT_WEB_SEARCH } from "./prompts";
import { INTELLIGENT_UI_PROMPT } from "@/lib/chat/intelligent-ui/authoring";

describe("visual answer prompts", () => {
  it("asks the model to diagram ordered or explicitly visual requests instead of defaulting to prose", () => {
    expect(GLOBAL_SYSTEM_PROMPT).toContain("主动给出 LumenFlow");
    expect(GLOBAL_SYSTEM_PROMPT).toContain("不要因为正文已经能说明就省略图示");
    expect(GLOBAL_SYSTEM_PROMPT_WEB_SEARCH).toContain("应主动使用图示");
    for (const prompt of [GLOBAL_SYSTEM_PROMPT, GLOBAL_SYSTEM_PROMPT_WEB_SEARCH]) {
      expect(prompt).toContain("32 个字符");
    }
  });

  it("keeps the intelligent UI proactive without turning every answer into a widget", () => {
    expect(INTELLIGENT_UI_PROMPT).toContain("应主动给出图示或界面");
    expect(INTELLIGENT_UI_PROMPT).toContain("只写正文");
    expect(INTELLIGENT_UI_PROMPT).toContain("正文必须完整可独立阅读");
  });
});
