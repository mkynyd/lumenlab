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
    expect(onSend).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "快捷任务：生成实验报告",
        materialScope: "project-corpus",
        prompt: expect.stringContaining("基于我选中的资料"),
      })
    );
  });

  it("keeps less common tasks in the compact more menu", async () => {
    const user = userEvent.setup();
    render(<QuickTaskBar projectType="coding" onSend={vi.fn()} />);

    await user.click(
      screen.getByRole("button", { name: "更多快捷任务" })
    );

    expect(
      screen.getByRole("menuitem", { name: "整理实验报告代码说明" })
    ).toBeInTheDocument();
  });

  it("keeps built-in and personalized actions without expanding another button row", async () => {
    const user = userEvent.setup();
    render(
      <QuickTaskBar
        projectType="general"
        actions={[{ id: "custom-1", title: "漏洞分析", prompt: "分析漏洞", isSystem: true }]}
        onSend={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "总结要点" })).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "更多快捷任务" })
    );

    expect(
      screen.getByRole("menuitem", { name: "生成 Mermaid 逻辑图" })
    ).toBeInTheDocument();
    expect(screen.getByText("我的任务")).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "漏洞分析" })
    ).toBeInTheDocument();
  });

  it("sends an overflow task from the more menu", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();

    render(<QuickTaskBar projectType="review" onSend={onSend} />);

    await user.click(
      screen.getByRole("button", { name: "更多快捷任务" })
    );
    await user.click(
      screen.getByRole("menuitem", { name: "生成速记版" })
    );

    expect(onSend).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "快捷任务：生成速记版",
        materialScope: "project-corpus",
      })
    );
  });

  it("sends a task from the compact mobile menu", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();

    render(<QuickTaskBar projectType="experiment" onSend={onSend} />);

    await user.click(
      screen.getByRole("button", { name: "打开快捷任务" })
    );
    await user.click(
      screen.getByRole("menuitem", { name: "生成误差分析" })
    );

    expect(onSend).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "快捷任务：生成误差分析",
        materialScope: "project-corpus",
      })
    );
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
