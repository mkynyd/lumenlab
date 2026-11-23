import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { makeSurface, readUIGroup, type UIGroup } from "@/lib/chat/intelligent-ui/catalog";
import IntelligentSurface from "./surface";

function surface(...descriptions: unknown[]) {
  const groups: UIGroup[] = [];
  for (const description of descriptions) {
    const group = readUIGroup(description, groups);
    if (!group) throw new Error("Invalid test group");
    groups.push(group);
  }
  return makeSurface("test-assistant", groups);
}

const control = {
  id: "control",
  state: [{ name: "power", kind: "number", initial: 4, min: 1, max: 10, step: 1 }],
  nodes: [
    { id: "input", type: "input", props: { label: "输入", bind: "power" } },
    { id: "reset", type: "button", props: { label: "重置", action: { kind: "reset" } } },
  ],
};
const calculator = {
  id: "results",
  nodes: [{ id: "total", type: "value", props: { label: "响应值", value: { op: "*", args: [{ ref: "power" }, 2] } } },
    { id: "ask", type: "button", props: { label: "带入追问", action: { kind: "draft", text: "解释当前值", values: [{ ref: "power" }] } } }],
};

describe("one host renderer for unrelated chat output", () => {
  it("keeps local input and focus when a dependent group arrives", () => {
    const onDraft = vi.fn();
    const first = surface(control);
    const { rerender } = render(<IntelligentSurface surface={first} onDraft={onDraft} />);
    const input = screen.getByRole("spinbutton", { name: "输入" });
    input.focus();
    fireEvent.change(input, { target: { value: "6" } });
    const second = readUIGroup(calculator, first.groups)!;
    rerender(<IntelligentSurface surface={makeSurface(first.surfaceId, [...first.groups, second])} onDraft={onDraft} />);
    expect(document.activeElement).toBe(input);
    expect(screen.getByLabelText("响应值").textContent).toBe("12");
    fireEvent.click(screen.getByRole("button", { name: "带入追问" }));
    expect(onDraft).toHaveBeenCalledWith("解释当前值 6");
    fireEvent.click(screen.getByRole("button", { name: "重置" }));
    expect(screen.getByLabelText("响应值").textContent).toBe("8");
  });

  it("renders a comparison with a demo table and separate educational steps", () => {
    render(<IntelligentSurface surface={surface({
      id: "compare",
      nodes: [{ id: "layout", type: "compare", props: { title: "比较缓存" }, children: [
        { id: "table", type: "table", props: { label: "命中", source: "demo", columns: ["方案", "命中数"], rows: [["LRU", 6], ["FIFO", 3]] } },
        { id: "steps", type: "steps", props: { items: ["选取中点", "缩小范围", "找到目标"], current: 1 } },
      ] }],
    })} />);
    expect(screen.getByRole("table", { name: "命中 （演示数据）" })).toBeTruthy();
    expect(screen.getByText("缩小范围").getAttribute("aria-current")).toBe("step");
  });

  it("presents a changing partition with compact controls and current values", () => {
    const group = {
      id: "partition",
      state: [{ name: "phase", kind: "number", initial: 0, min: 0, max: 1, step: 1 }],
      nodes: [{ id: "allocation", type: "sequence", props: { bind: "phase", label: "内存分配", frames: [
        { segments: [{ label: "初始区间", span: 16, detail: "16 MiB" }] },
        { segments: [{ label: "第一块", span: 4, detail: "4 MiB" }, { label: "剩余区间", span: 12, detail: "12 MiB" }] },
      ] } }],
    };
    render(<IntelligentSurface surface={surface(group)} />);
    const previous = screen.getByRole("button", { name: "上一步" }) as HTMLButtonElement;
    const next = screen.getByRole("button", { name: "下一步" }) as HTMLButtonElement;
    const segments = screen.getByRole("list", { name: "当前分段" });
    expect(previous.disabled).toBe(true);
    expect(within(segments).getByText("16 MiB")).toBeTruthy();
    fireEvent.click(next);
    expect(screen.getByRole("status", { name: "步骤 2，共 2 步" }).textContent).toBe("2/2");
    expect(within(segments).getByText("12 MiB")).toBeTruthy();
    expect(next.disabled).toBe(true);
    fireEvent.click(previous);
    expect(within(segments).getByText("16 MiB")).toBeTruthy();
  });

  it("combines a chart and local state without a scenario-specific component", async () => {
    render(<IntelligentSurface surface={surface(control, {
      id: "chart",
      nodes: [{ id: "points", type: "line", props: {
        label: "实验参数敏感度", unit: "mV", source: "demo", labels: ["A", "B"],
        series: [{ label: "响应值", values: [{ ref: "power" }, { op: "*", args: [{ ref: "power" }, 2] }] }],
      } }],
    })} />);
    await waitFor(() => { expect(screen.getByRole("figure", { name: /实验参数敏感度/ })).toBeTruthy(); });
    const table = screen.getByRole("figure").querySelector("table")!;
    fireEvent.click(screen.getByText("数据表"));
    expect(within(table).getByText("8")).toBeTruthy();
    fireEvent.change(screen.getByRole("spinbutton", { name: "输入" }), { target: { value: "7" } });
    expect(within(table).getByText("14")).toBeTruthy();
  });
});
