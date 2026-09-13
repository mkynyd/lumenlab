import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ModelSelector } from "@/components/chat/model-selector";

describe("ModelSelector", () => {
  it("keeps the desktop picker open and reflects the selected model", async () => {
    const user = userEvent.setup();

    function Harness() {
      const [model, setModel] = useState("deepseek-flash");
      return (
        <ModelSelector
          model={model}
          onChange={setModel}
          reasoningEffort="max"
          onReasoningEffortChange={vi.fn()}
          availableModels={["deepseek-flash", "minimax-m3"]}
        />
      );
    }

    render(<Harness />);
    const desktopTrigger = screen.getAllByRole("button", { name: "选择模型" })[0];
    await user.click(desktopTrigger);
    await user.click(screen.getByRole("menuitemradio", { name: /MiniMax M3/ }));

    expect(screen.getByRole("menu")).toBeVisible();
    expect(screen.getByRole("menuitemradio", { name: /MiniMax M3/ })).toBeChecked();
    expect(desktopTrigger).toHaveTextContent("MiniMax M3");
  });

  it("shows the catalog-backed model detail and reasoning meter on desktop", async () => {
    const user = userEvent.setup();
    const onReasoningEffortChange = vi.fn();
    render(
      <ModelSelector
        model="deepseek-flash"
        onChange={vi.fn()}
        reasoningEffort="max"
        onReasoningEffortChange={onReasoningEffortChange}
        availableModels={["deepseek-flash", "minimax-m3"]}
      />
    );

    await user.click(screen.getAllByRole("button", { name: "选择模型" })[0]);

    expect(screen.getByText("1M tokens")).toBeInTheDocument();
    expect(screen.getByText("最大输出")).toBeInTheDocument();
    expect(screen.getByTestId("model-detail-card")).toHaveClass("rounded-[var(--radius-xl)]");
    expect(screen.getAllByRole("radio", { name: "深度" })[0]).toBeChecked();
    expect(screen.getByTestId("reasoning-meter").children).toHaveLength(5);

    await user.click(screen.getAllByRole("radio", { name: "快速" })[0]);
    expect(onReasoningEffortChange).toHaveBeenCalledWith("high");
  });

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

    expect(screen.getByRole("dialog")).toHaveTextContent("配置");
    const deepseekOption = screen.getByRole("button", {
      name: /DeepSeek V4\.1 Flash/,
    });
    // 模型名下方带一行官方口径小字介绍
    expect(deepseekOption).toHaveTextContent("多模态视觉理解");
    expect(screen.getByRole("button", { name: "完成" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "快速" })).toHaveClass("h-8");
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
    await user.click(screen.getByRole("button", { name: /MiniMax M3/ }));

    expect(onChange).toHaveBeenCalledWith("minimax-m3");
    expect(onReasoningEffortChange).not.toHaveBeenCalled();
  });
});
