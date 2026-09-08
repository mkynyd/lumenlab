import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MessageBubble } from "./message-bubble";
import type { AssistantProcessTrace } from "@/lib/agent/assistant-process";

const trace: AssistantProcessTrace = {
  status: "completed",
  startedAt: Date.now() - 4_000,
  completedAt: Date.now(),
  tools: [
    {
      executionId: "search-1",
      toolId: "web.search",
      label: "搜索公开资料",
      status: "completed",
      sources: [{ type: "web", title: "来源一", url: "https://example.com/one" }],
    },
  ],
};

function reasoningSurfaces() {
  return document.querySelectorAll(".assistant-process-reasoning");
}

describe("MessageBubble 思考过程渲染", () => {
  it("无 process 但存在历史推理时只渲染一套思考过程", () => {
    render(
      <MessageBubble
        role="assistant"
        content="最终回答"
        reasoningContent="先核对事实，再组织回答。"
      />
    );

    expect(reasoningSurfaces()).toHaveLength(1);
    expect(screen.getAllByText("先核对事实，再组织回答。")).toHaveLength(1);
    expect(screen.getAllByText("思考过程")).toHaveLength(1);
  });

  it("process 与推理同时存在时只渲染一套思考过程", () => {
    render(
      <MessageBubble
        role="assistant"
        content="最终回答"
        reasoningContent="需要先检索资料。"
        process={trace}
      />
    );

    expect(reasoningSurfaces()).toHaveLength(1);
    expect(screen.getAllByText("需要先检索资料。")).toHaveLength(1);
    expect(screen.getAllByText("搜索公开资料")).toHaveLength(1);
  });

  it("无推理且无 process 时不出现思考过程区域", () => {
    render(<MessageBubble role="assistant" content="直接回答" />);

    expect(reasoningSurfaces()).toHaveLength(0);
    expect(screen.queryByText("思考过程")).toBeNull();
    expect(document.querySelector(".assistant-process")).toBeNull();
  });

  it("无推理且无 process 的流式首字等待只显示一次等待状态", () => {
    render(<MessageBubble role="assistant" content="" isStreaming />);

    expect(document.querySelector(".assistant-process")).toBeNull();
    expect(screen.getAllByText("等待模型响应")).toHaveLength(1);
    expect(screen.queryByText("正在准备")).toBeNull();
  });

  it("流式推理展开显示单套推理内容", () => {
    render(
      <MessageBubble
        role="assistant"
        content=""
        reasoningContent="正在核对资料。"
        isStreaming
      />
    );

    expect(reasoningSurfaces()).toHaveLength(1);
    const surface = document.querySelector(".assistant-process");
    expect(surface?.getAttribute("data-state")).toBe("running");
    expect(screen.getAllByText("正在核对资料。")).toHaveLength(1);
    expect(screen.getAllByText("正在思考")).toHaveLength(1);
  });

  it("失败的 process 使用明确状态而不是完成态", () => {
    render(
      <MessageBubble
        role="assistant"
        content="部分回答"
        reasoningContent="推理内容"
        process={{ ...trace, status: "failed" }}
      />
    );

    const header = screen.getByRole("button", { name: /思考/ });
    expect(within(header).queryByText(/已中断|失败/)).toBeTruthy();
    expect(reasoningSurfaces()).toHaveLength(1);
  });

  it("用户消息不渲染思考过程区域", () => {
    render(<MessageBubble role="user" content="问题" />);

    expect(reasoningSurfaces()).toHaveLength(0);
    expect(document.querySelector(".assistant-process")).toBeNull();
  });
});
