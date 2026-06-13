import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { QuickTaskBar } from "@/components/chat/quick-task-bar";

describe("QuickTaskBar", () => {
  it("fills a complete experiment report prompt without sending it", async () => {
    const user = userEvent.setup();
    const onFill = vi.fn();

    render(<QuickTaskBar projectType="experiment" onFill={onFill} />);

    await user.click(
      screen.getByRole("button", { name: "生成实验报告" })
    );

    expect(onFill).toHaveBeenCalledOnce();
    expect(onFill.mock.calls[0][0]).toContain("基于我选中的资料");
    expect(onFill.mock.calls[0][0]).toContain("不要编造");
  });

  it("includes the report code explanation task for coding projects", () => {
    render(<QuickTaskBar projectType="coding" onFill={vi.fn()} />);

    expect(
      screen.getByRole("button", { name: "整理实验报告代码说明" })
    ).toBeInTheDocument();
  });
});
