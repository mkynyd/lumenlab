import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ModelSelector } from "@/components/chat/model-selector";

describe("ModelSelector", () => {
  it("provides a mobile bottom-sheet selector with touch-sized choices", async () => {
    const user = userEvent.setup();
    render(
      <ModelSelector
        model="deepseek-v4-pro"
        onChange={vi.fn()}
        onReasoningEffortChange={vi.fn()}
      />
    );

    const triggers = screen.getAllByRole("button", {
      name: "选择模型",
    });
    await user.click(triggers.at(-1)!);

    expect(screen.getByRole("dialog")).toHaveTextContent("选择模型");
    expect(
      screen.getByRole("button", { name: "DeepSeek V4 Flash" })
    ).toHaveClass("h-11");
    expect(screen.getByRole("button", { name: "快速" })).toHaveClass("h-11");
  });

  it("keeps model and reasoning effort independent", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onReasoningEffortChange = vi.fn();
    render(
      <ModelSelector
        model="deepseek-v4-pro"
        onChange={onChange}
        reasoningEffort="max"
        onReasoningEffortChange={onReasoningEffortChange}
      />
    );

    const triggers = screen.getAllByRole("button", { name: "选择模型" });
    await user.click(triggers.at(-1)!);
    await user.click(screen.getByRole("button", { name: "MiniMax M3" }));

    expect(onChange).toHaveBeenCalledWith("minimax-m3");
    expect(onReasoningEffortChange).not.toHaveBeenCalled();
  });
});
