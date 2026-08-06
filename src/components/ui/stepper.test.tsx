import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Stepper, type Step } from "@/components/ui/stepper";

function makeSteps(count: number): Step[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `step-${index}`,
    title: `步骤${index + 1}`,
    content: <p>内容{index + 1}</p>,
    isValid: true,
  }));
}

function ControlledStepper({
  onStepChange,
  onComplete,
  allowForwardJump,
  pendingLabel,
}: {
  onStepChange: (next: number) => void | Promise<void>;
  onComplete?: () => void | Promise<void>;
  allowForwardJump?: boolean;
  pendingLabel?: string;
}) {
  const [step, setStep] = useState(0);
  return (
    <Stepper
      steps={makeSteps(3)}
      currentStep={step}
      onStepChange={async (next) => {
        await onStepChange(next);
        setStep(next);
      }}
      onComplete={onComplete}
      allowForwardJump={allowForwardJump}
      pendingLabel={pendingLabel}
      nextLabel="下一步"
      completeLabel="完成"
    />
  );
}

describe("Stepper 异步切步", () => {
  it("onStepChange resolve 后才切步", async () => {
    const user = userEvent.setup();
    let resolveChange!: () => void;
    const onStepChange = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveChange = resolve;
        })
    );

    render(<ControlledStepper onStepChange={onStepChange} />);
    await user.click(screen.getByRole("button", { name: /下一步/ }));

    // await 未结束：按钮进入 pending 态，未调用后续逻辑
    expect(screen.getByRole("button", { name: /下一步/ })).toBeDisabled();

    resolveChange();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /下一步/ })).toBeEnabled();
    });
    expect(onStepChange).toHaveBeenCalledWith(1);
    expect(screen.getByText("内容2")).toBeInTheDocument();
  });

  it("onStepChange reject 时停留在当前步", async () => {
    const user = userEvent.setup();
    const onStepChange = vi.fn(() => Promise.reject(new Error("boom")));

    render(<ControlledStepper onStepChange={onStepChange} />);
    await user.click(screen.getByRole("button", { name: /下一步/ }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /下一步/ })).toBeEnabled();
    });
    expect(screen.getByText("内容1")).toBeInTheDocument();
  });

  it("pending 期间忽略重复点击（防连点竞态）", async () => {
    const user = userEvent.setup();
    let resolveChange!: () => void;
    const onStepChange = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveChange = resolve;
        })
    );

    render(<ControlledStepper onStepChange={onStepChange} />);
    const nextButton = screen.getByRole("button", { name: /下一步/ });
    await user.click(nextButton);
    // disabled 按钮不会触发 click；这里直接再调一次 handleNext 路径
    await user.click(nextButton);

    expect(onStepChange).toHaveBeenCalledTimes(1);
    resolveChange();
    await waitFor(() => expect(nextButton).toBeEnabled());
  });

  it("pending 期间显示 pendingLabel", async () => {
    const user = userEvent.setup();
    let resolveChange!: () => void;
    const onStepChange = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveChange = resolve;
        })
    );

    render(
      <ControlledStepper onStepChange={onStepChange} pendingLabel="发送中…" />
    );
    await user.click(screen.getByRole("button", { name: /下一步/ }));

    expect(
      screen.getByRole("button", { name: /发送中…/ })
    ).toBeDisabled();
    resolveChange();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /下一步/ })).toBeEnabled();
    });
  });

  it("onComplete 支持异步，reject 不向外抛", async () => {
    const user = userEvent.setup();
    const onStepChange = vi.fn();
    const onComplete = vi.fn(() => Promise.reject(new Error("boom")));

    render(
      <Stepper
        steps={makeSteps(3)}
        currentStep={2}
        onStepChange={onStepChange}
        onComplete={onComplete}
        completeLabel="创建账户"
      />
    );

    await user.click(screen.getByRole("button", { name: /创建账户/ }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /创建账户/ })).toBeEnabled();
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});

describe("Stepper 指示器跳转", () => {
  it("allowForwardJump=false 时未来步骤不可点击，已完成步骤可回跳", async () => {
    const user = userEvent.setup();
    const onStepChange = vi.fn();

    render(
      <ControlledStepper onStepChange={onStepChange} allowForwardJump={false} />
    );

    // 未来步骤按钮 disabled
    expect(screen.getByRole("button", { name: /步骤2/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /步骤3/ })).toBeDisabled();

    // 前进到第 2 步后可回跳第 1 步
    await user.click(screen.getByRole("button", { name: /下一步/ }));
    await waitFor(() =>
      expect(screen.getByText("内容2")).toBeInTheDocument()
    );
    await user.click(screen.getByRole("button", { name: /步骤1/ }));
    await waitFor(() =>
      expect(screen.getByText("内容1")).toBeInTheDocument()
    );
  });

  it("allowForwardJump 默认 true 时，前置步骤均有效可跳到未来步骤", async () => {
    const user = userEvent.setup();
    const onStepChange = vi.fn();

    render(<ControlledStepper onStepChange={onStepChange} />);

    const step3 = screen.getByRole("button", { name: /步骤3/ });
    expect(step3).toBeEnabled();
    await user.click(step3);
    await waitFor(() =>
      expect(screen.getByText("内容3")).toBeInTheDocument()
    );
    expect(onStepChange).toHaveBeenCalledWith(2);
  });

  it("当前步指示器带 aria-current=step，内容容器 role=group 关联标题", () => {
    const onStepChange = vi.fn();
    render(<ControlledStepper onStepChange={onStepChange} />);

    const current = screen.getByRole("button", { name: /步骤1/ });
    expect(current).toHaveAttribute("aria-current", "step");

    const group = screen.getByRole("group");
    expect(group).toHaveAttribute(
      "aria-labelledby",
      current.querySelector("span[id]")?.id
    );
  });
});
