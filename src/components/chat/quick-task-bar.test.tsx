import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { QuickTaskBar } from "@/components/chat/quick-task-bar";

describe("QuickTaskBar", () => {
  it("sends a quick task label with the full prompt hidden from the UI", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();

    render(<QuickTaskBar projectType="experiment" onSend={onSend} />);

    await user.click(
      screen.getByRole("button", { name: "生成实验报告" })
    );

    expect(onSend).toHaveBeenCalledOnce();
    expect(onSend).toHaveBeenCalledWith({
      label: "快捷任务：生成实验报告",
      prompt: expect.stringContaining("基于我选中的资料"),
    });
  });

  it("includes the report code explanation task for coding projects", async () => {
    const user = userEvent.setup();
    render(<QuickTaskBar projectType="coding" onSend={vi.fn()} />);

    // The quick task bar collapses system actions to 2 by default; expand first
    await user.click(screen.getByRole("button", { name: /更多/ }));

    expect(
      screen.getByRole("button", { name: "整理实验报告代码说明" })
    ).toBeInTheDocument();
  });

  it("uses neutral project controls and hover states", () => {
    render(<QuickTaskBar projectType="review" onSend={vi.fn()} />);

    const action = screen.getByRole("button", { name: "提取知识点" });
    expect(action).toHaveClass(
      "bg-[var(--color-project-control)]",
      "text-[var(--color-text-secondary)]",
      "hover:bg-[var(--color-project-surface-hover)]",
      "hover:text-[var(--color-text-primary)]"
    );
  });
});
