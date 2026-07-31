import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PracticeItemCard } from "@/components/learning/practice-item-card";
import type {
  AttemptAnswer,
  PracticeItemClientDto,
} from "@/lib/hooks/use-learning-api";
import { fixturePracticeItem } from "@/components/learning/__fixtures__/learning-fixtures";

function Harness({
  item,
  initial = null,
  onChange,
  disabled,
}: {
  item: PracticeItemClientDto;
  initial?: AttemptAnswer | null;
  onChange: (value: AttemptAnswer) => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState<AttemptAnswer | null>(initial);
  return (
    <PracticeItemCard
      item={item}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
      disabled={disabled}
    />
  );
}

describe("PracticeItemCard", () => {
  it("single_choice 渲染 radio 组并以 optionId 字符串回调", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness item={fixturePracticeItem()} onChange={onChange} />);

    const group = screen.getByRole("radiogroup");
    expect(group).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "根左右" }));
    expect(onChange).toHaveBeenLastCalledWith("opt-b");
    expect(screen.getByRole("radio", { name: "根左右" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "左根右" })).not.toBeChecked();
  });

  it("multiple_choice 渲染 checkbox 组并以 optionId 数组回调", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const item = fixturePracticeItem({
      type: "multiple_choice",
      options: [
        { id: "opt-a", label: "深度优先" },
        { id: "opt-b", label: "广度优先" },
        { id: "opt-c", label: "中序优先" },
      ],
    });
    render(<Harness item={item} initial={["opt-a"]} onChange={onChange} />);

    expect(screen.getByRole("checkbox", { name: "深度优先" })).toBeChecked();

    await user.click(screen.getByRole("checkbox", { name: "广度优先" }));
    expect(onChange).toHaveBeenLastCalledWith(["opt-a", "opt-b"]);

    await user.click(screen.getByRole("checkbox", { name: "深度优先" }));
    expect(onChange).toHaveBeenLastCalledWith(["opt-b"]);
  });

  it("true_false 渲染两个 radio 并以 boolean 回调", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const item = fixturePracticeItem({ type: "true_false", options: null });
    render(<Harness item={item} onChange={onChange} />);

    await user.click(screen.getByRole("radio", { name: "错误" }));
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole("radio", { name: "错误" })).toBeChecked();

    await user.click(screen.getByRole("radio", { name: "正确" }));
    expect(onChange).toHaveBeenLastCalledWith(true);
  });

  it("numeric 渲染数字输入并以 number 回调，清空时回调空串", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const item = fixturePracticeItem({ type: "numeric", options: null });
    render(<Harness item={item} onChange={onChange} />);

    const input = screen.getByRole("spinbutton", { name: "作答" });
    await user.type(input, "4");
    expect(onChange).toHaveBeenLastCalledWith(4);

    await user.clear(input);
    expect(onChange).toHaveBeenLastCalledWith("");
  });

  it("short_answer 渲染带关联 label 的 textarea 并以 string 回调", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const item = fixturePracticeItem({ type: "short_answer", options: null });
    render(<Harness item={item} onChange={onChange} />);

    const textarea = screen.getByRole("textbox", { name: "作答" });
    await user.type(textarea, "旋转条件");
    expect(onChange).toHaveBeenLastCalledWith("旋转条件");
  });

  it("long_answer / proof / open_design 均渲染 textarea", () => {
    for (const type of ["long_answer", "proof", "open_design"]) {
      const item = fixturePracticeItem({ type, options: null });
      const { unmount } = render(
        <PracticeItemCard item={item} value={null} onChange={vi.fn()} />
      );
      expect(screen.getByRole("textbox", { name: "作答" })).toBeInTheDocument();
      unmount();
    }
  });

  it("选项缺失时降级为 textarea 并显示提示", () => {
    const item = fixturePracticeItem({ type: "single_choice", options: null });
    render(<PracticeItemCard item={item} value={null} onChange={vi.fn()} />);

    expect(screen.getByRole("textbox", { name: "作答" })).toBeInTheDocument();
    expect(screen.getByText("选项不可用，请用文字作答")).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  });

  it("feedback_only 模式显示次级说明", () => {
    const item = fixturePracticeItem({ mode: "feedback_only" });
    render(<PracticeItemCard item={item} value={null} onChange={vi.fn()} />);

    expect(
      screen.getByText("此题只提供反馈，不影响掌握度")
    ).toBeInTheDocument();
  });

  it("disabled 时所有控件不可交互", () => {
    render(
      <PracticeItemCard
        item={fixturePracticeItem()}
        value={null}
        onChange={vi.fn()}
        disabled
      />
    );

    for (const radio of screen.getAllByRole("radio")) {
      expect(radio).toBeDisabled();
    }
  });
});
