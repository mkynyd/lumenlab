import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AgentRunStatus } from "./agent-run-status";

describe("AgentRunStatus", () => {
  it("shows the public plan and current user decision", () => {
    render(
      <AgentRunStatus
        plan={{
          title: "研究计划",
          status: "in_progress",
          currentStepId: "gather",
          steps: [
            { id: "understand", title: "明确问题", status: "completed" },
            { id: "gather", title: "收集资料", status: "in_progress" },
          ],
        }}
        needsUserDecision
      />
    );

    expect(screen.getByText("研究计划")).toBeInTheDocument();
    expect(screen.getByText("收集资料")).toBeInTheDocument();
    expect(screen.getByText("等待你的决定")).toBeInTheDocument();
  });

  it("renders nothing without a plan or pending decision", () => {
    const { container } = render(<AgentRunStatus />);

    expect(container).toBeEmptyDOMElement();
  });
});
