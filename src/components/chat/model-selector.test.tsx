import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModelSelector } from "@/components/chat/model-selector";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("ModelSelector", () => {
  beforeEach(() => vi.stubGlobal("ResizeObserver", ResizeObserverStub));
  afterEach(() => vi.unstubAllGlobals());

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
          availableModels={["deepseek-flash", "qwen3.8-flash"]}
        />
      );
    }

    render(<Harness />);
    const desktopTrigger = screen.getAllByRole("button", { name: "选择模型" })[0];
    await user.click(desktopTrigger);
    await user.click(screen.getByRole("button", { name: /切换模型/ }));
    await user.click(screen.getByRole("radio", { name: /Qwen3\.8-Flash/ }));

    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByRole("radio", { name: /Qwen3\.8-Flash/ })).toBeChecked();
    expect(desktopTrigger).toHaveTextContent("Qwen3.8-Flash");
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "深度" })).toBeChecked();
  });

  it("shows the catalog-backed model detail and a three-stop reasoning slider on desktop", async () => {
    const user = userEvent.setup();
    const onReasoningEffortChange = vi.fn();
    render(
      <ModelSelector
        model="deepseek-flash"
        onChange={vi.fn()}
        reasoningEffort="max"
        onReasoningEffortChange={onReasoningEffortChange}
        availableModels={["deepseek-flash", "qwen3.8-flash"]}
      />
    );

    await user.click(screen.getAllByRole("button", { name: "选择模型" })[0]);

    expect(screen.queryByRole("term", { name: "上下文" })).not.toBeInTheDocument();
    const details = screen.getByRole("button", { name: "模型详情" });
    expect(details).toHaveAttribute("aria-expanded", "false");
    await user.click(details);
    expect(details).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("1M tokens")).toBeInTheDocument();
    expect(screen.getByText("最大输出")).toBeInTheDocument();
    const slider = screen.getByRole("slider", { name: "思考深度" });
    expect(slider).toHaveAttribute("aria-valuetext", "最高");
    expect(slider).toHaveAttribute("aria-valuemax", "2");

    slider.focus();
    await user.keyboard("{ArrowLeft}");
    expect(onReasoningEffortChange).toHaveBeenLastCalledWith("high");
    await user.keyboard("{Home}");
    expect(onReasoningEffortChange).toHaveBeenLastCalledWith("low");
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
    await user.click(screen.getByRole("button", { name: /切换模型/ }));
    const deepseekOption = screen.getByRole("radio", {
      name: /DeepSeek V4\.1 Flash/,
    });
    expect(deepseekOption).toHaveTextContent("DeepSeek V4.1 Flash");
    expect(screen.queryByText("最大输出")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "模型详情" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "完成" })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "思考深度" })).toHaveAttribute("aria-valuetext", "最高");
  });

  it("keeps model and reasoning effort independent", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onReasoningEffortChange = vi.fn();
    render(
      <ModelSelector
        model="deepseek-v4-pro"
        availableModels={["deepseek-flash", "qwen3.8-flash"]}
        onChange={onChange}
        reasoningEffort="max"
        onReasoningEffortChange={onReasoningEffortChange}
      />
    );

    const triggers = screen.getAllByRole("button", { name: "选择模型" });
    await user.click(triggers.at(-1)!);
    await user.click(screen.getByRole("button", { name: /切换模型/ }));
    await user.click(screen.getByRole("radio", { name: /Qwen3\.8-Flash/ }));

    expect(onChange).toHaveBeenCalledWith("qwen3.8-flash");
    expect(onReasoningEffortChange).not.toHaveBeenCalled();
  });
});
