import { describe, expect, it } from "vitest";
import {
  NEW_CONVERSATION_TITLE,
  conversationBootstrapTitle,
  conversationTitleFallback,
  normalizeConversationTitle,
  sanitizeGeneratedTitle,
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

  it("rejects refusal-like model output instead of persisting it", () => {
    expect(sanitizeGeneratedTitle("信息不足，无法概括")).toBeNull();
    expect(sanitizeGeneratedTitle("无法生成标题：首条消息内容不足")).toBeNull();
    expect(sanitizeGeneratedTitle("抱歉，我无法总结这个对话")).toBeNull();
    expect(normalizeConversationTitle("信息不足，无法概括", "考研数学")).toBe("考研数学");
  });

  it("uses the first message or attachment as a deterministic bootstrap title", () => {
    expect(conversationBootstrapTitle("请帮我整理牛顿迭代法")).toBe("请帮我整理牛顿迭代法");
    expect(conversationBootstrapTitle("", [{ kind: "image" }])).toBe("图片对话");
    expect(conversationBootstrapTitle("", [{ kind: "file" }])).toBe("文件对话");
  });
});
