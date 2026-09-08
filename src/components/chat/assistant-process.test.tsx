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

  it("等待首字时只显示准备状态，不显示空推理区", () => {
    render(
      <AssistantProcess
        trace={{ status: "running", startedAt: Date.now(), tools: [] }}
        isStreaming
        hasResponse={false}
      />
    );

    expect(screen.getByText("正在准备")).toBeTruthy();
    expect(document.querySelector(".assistant-process-reasoning")).toBeNull();
    expect(document.querySelector(".assistant-process-body")?.textContent).toBe("");
  });

  it("推理中展开显示推理并标记正在思考", () => {
    render(
      <AssistantProcess
        trace={{ status: "running", startedAt: Date.now(), tools: [] }}
        reasoningContent="先核对事实。"
        isStreaming
        hasResponse={false}
      />
    );

    expect(screen.getByText("正在思考")).toBeTruthy();
    expect(document.querySelector(".assistant-process")?.getAttribute("data-state")).toBe("running");
    expect(screen.getByLabelText("思考过程").textContent).toBe("先核对事实。");
  });

  it("无 process 的历史推理复用同一过程区并默认折叠", () => {
    render(
      <AssistantProcess reasoningContent="历史推理内容" isStreaming={false} hasResponse />
    );

    expect(screen.getByText("思考过程")).toBeTruthy();
    expect(document.querySelector(".assistant-process")?.getAttribute("data-state")).toBe("completed");
    expect(document.querySelector(".assistant-process-reasoning")?.textContent).toBe("历史推理内容");
  });

  it("审批中默认展开并显示等待确认", () => {
    const preview = {
      toolId: "web.fetch",
      toolName: "读取网页",
      summary: "读取外部网页",
      affectedResources: [],
      sendsToExternal: true,
      isReversible: true,
      dataTypes: ["url"],
    };
    render(
      <AssistantProcess
        trace={{
          status: "running",
          startedAt: Date.now(),
          tools: [
            {
              executionId: "approval-1",
              toolId: "web.fetch",
              label: "读取外部网页",
              status: "awaiting_approval",
              sources: [],
              preview,
              approval: { token: "token-1", expiresAt: Date.now() + 60_000, canApproveSession: false },
            },
          ],
        }}
        isStreaming
        hasResponse={false}
      />
    );

    expect(screen.getByText("等待你的确认")).toBeTruthy();
    expect(screen.getByText("读取外部网页")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /等待你的确认/ }).getAttribute("aria-expanded")
    ).toBe("true");
  });

  it("失败与取消使用明确终态标签", () => {
    const { rerender } = render(
      <AssistantProcess
        trace={{ ...trace, status: "failed", completedAt: Date.now() }}
        reasoningContent="推理内容"
        isStreaming={false}
        hasResponse
      />
    );

    expect(screen.getByRole("button", { name: /已中断/ })).toBeTruthy();

    rerender(
      <AssistantProcess
        trace={{ ...trace, status: "cancelled", completedAt: Date.now() }}
        reasoningContent="推理内容"
        isStreaming={false}
        hasResponse
      />
    );

    expect(screen.getByRole("button", { name: /已取消/ })).toBeTruthy();
  });

  it("流式期间手动展开后状态保持稳定", () => {
    const { rerender } = render(
      <AssistantProcess
        trace={{ status: "running", startedAt: Date.now(), tools: [] }}
        reasoningContent="推理内容"
        isStreaming
        hasResponse={false}
      />
    );

    const trigger = screen.getByRole("button", { name: /思考/ });
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    rerender(
      <AssistantProcess
        trace={{ status: "running", startedAt: Date.now(), tools: [] }}
        reasoningContent="推理内容继续"
        isStreaming
        hasResponse={false}
      />
    );

    expect(screen.getByRole("button", { name: /思考/ }).getAttribute("aria-expanded")).toBe("false");
  });
});
