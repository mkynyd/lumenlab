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
      name: "选择模型强度和模型",
    });
    await user.click(triggers.at(-1)!);

    expect(screen.getByRole("dialog")).toHaveTextContent("选择模型");
    expect(screen.getByRole("button", { name: "快速" })).toHaveClass("h-11");
    expect(screen.getByRole("button", { name: "DeepSeek" })).toHaveClass("h-11");
  });
});
