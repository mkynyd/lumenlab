import { describe, expect, it } from "vitest";
import {
  NEW_CONVERSATION_TITLE,
  conversationTitleFallback,
  normalizeConversationTitle,
} from "@/lib/conversation-title";

describe("conversation title helpers", () => {
  it("keeps the pre-generation label neutral", () => {
    expect(NEW_CONVERSATION_TITLE).toBe("新对话");
  });

  it("normalizes model output into a concise navigation title", () => {
    expect(normalizeConversationTitle("标题：『考研数学试卷解析』", "新对话")).toBe(
      "考研数学试卷解析"
    );
  });

  it("limits a raw prompt fallback so it cannot occupy an entire row", () => {
    expect(conversationTitleFallback("请根据这个项目资料整理考研数学高数全部考点和例题")).toHaveLength(18);
  });
});
