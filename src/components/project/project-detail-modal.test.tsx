import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProjectDetailModal } from "@/components/project/project-detail-modal";

function renderModal(systemPrompt?: string | null) {
  return render(
    <ProjectDetailModal
      open
      onOpenChange={vi.fn()}
      projectName="电路实验"
      projectType="review"
      systemPrompt={systemPrompt}
      fileCount={3}
      conversationCount={2}
      artifactCount={1}
    />
  );
}

describe("ProjectDetailModal", () => {
  it("renders the project system prompt under the prompt tab", async () => {
    const user = userEvent.setup();
    renderModal("你是电路复习助手，优先基于资料回答。");

    await user.click(screen.getByRole("button", { name: /系统提示词/ }));

    expect(
      screen.getByText("你是电路复习助手，优先基于资料回答。")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("在「系统提示词」标签下查看项目专属提示词。")
    ).not.toBeInTheDocument();
  });

  it("shows a placeholder when the system prompt is not set", async () => {
    const user = userEvent.setup();
    renderModal(null);

    await user.click(screen.getByRole("button", { name: /系统提示词/ }));

    expect(screen.getByText("未设置")).toBeInTheDocument();
  });

  it("treats a blank system prompt as not set", async () => {
    const user = userEvent.setup();
    renderModal("   ");

    await user.click(screen.getByRole("button", { name: /系统提示词/ }));

    expect(screen.getByText("未设置")).toBeInTheDocument();
  });
});
