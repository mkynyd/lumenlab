import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AssistantProcess } from "./assistant-process";
import type { AssistantProcessTrace } from "@/lib/agent/assistant-process";

const trace: AssistantProcessTrace = {
  status: "running",
  startedAt: Date.now() - 2_000,
  plan: {
    title: "研究计划",
    status: "in_progress",
    currentStepId: "search",
    steps: [{ id: "search", title: "搜索可信来源", status: "in_progress" }],
  },
  tools: [{
    executionId: "search-1",
    toolId: "web.search",
    label: "搜索公开资料",
    status: "executing",
    sources: [
      { type: "web", title: "来源一", url: "https://example.com/one" },
      { type: "web", title: "来源二", url: "https://example.org/two" },
    ],
  }],
};

describe("AssistantProcess", () => {
  it("在同一过程区显示思考、计划、工具和逐条来源", () => {
    render(
      <AssistantProcess
        trace={trace}
        reasoningContent="先核对事实，再组织回答。"
        isStreaming
        hasResponse={false}
      />
    );

    expect(screen.getByText("先核对事实，再组织回答。")).toBeTruthy();
    expect(screen.getByText("搜索可信来源")).toBeTruthy();
    expect(screen.getByText("搜索公开资料")).toBeTruthy();
    expect(screen.getByText("来源一")).toBeTruthy();
    expect(screen.getByText("example.org")).toBeTruthy();
  });

  it("已完成状态默认折叠且可重新展开", () => {
    render(
      <AssistantProcess
        trace={{ ...trace, status: "completed", completedAt: Date.now() }}
        reasoningContent="已完成推理。"
        isStreaming={false}
        hasResponse
      />
    );

    const trigger = screen.getByRole("button", { name: /思考/ });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });
});
