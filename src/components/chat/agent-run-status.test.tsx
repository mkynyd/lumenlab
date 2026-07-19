import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AgentRunStatus } from "./agent-run-status";

describe("AgentRunStatus", () => {
  it("shows the public plan, current user decision, and an expandable capability reason", async () => {
    const user = userEvent.setup();
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
        explanations={[
          {
            type: "capability_explained",
            capability: "retrieval",
            title: "已检索相关资料",
            reason: "为了让回答可核验。",
            detail: "已纳入 2 条来源。",
          },
        ]}
        needsUserDecision
      />
    );

    expect(screen.getByText("研究计划")).toBeInTheDocument();
    expect(screen.getByText("收集资料")).toBeInTheDocument();
    expect(screen.getByText("等待你的决定")).toBeInTheDocument();
    await user.click(screen.getByText("为什么这样处理？"));
    expect(screen.getByText("为了让回答可核验。 已纳入 2 条来源。")).toBeInTheDocument();
  });
});
