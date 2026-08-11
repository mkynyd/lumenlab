import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FeedbackWidget } from "@/components/feedback/feedback-widget";

function mockRect(
  el: Element,
  rect: { left: number; top: number; width: number; height: number }
) {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    ...rect,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    x: rect.left,
    y: rect.top,
    toJSON: () => ({}),
  } as DOMRect);
}

describe("FeedbackWidget", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ status: 201, json: async () => ({ id: "fb-1" }) })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("opens the dialog from the floating button", () => {
    render(<FeedbackWidget />);
    fireEvent.click(screen.getByRole("button", { name: "反馈" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("问题反馈")).toBeTruthy();
  });

  it("submits category, content and current path", async () => {
    render(<FeedbackWidget />);
    fireEvent.click(screen.getByRole("button", { name: "反馈" }));
    fireEvent.click(screen.getByRole("button", { name: "Bug" }));
    fireEvent.change(screen.getByLabelText("问题描述"), { target: { value: "导出失败" } });
    fireEvent.click(screen.getByRole("button", { name: "提交反馈" }));

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/feedback");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      category: "bug",
      content: "导出失败",
      pagePath: window.location.pathname,
    });
  });

  it("requires content before submitting", () => {
    render(<FeedbackWidget />);
    fireEvent.click(screen.getByRole("button", { name: "反馈" }));
    fireEvent.click(screen.getByRole("button", { name: "提交反馈" }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shows success message and resets after submit", async () => {
    render(<FeedbackWidget />);
    fireEvent.click(screen.getByRole("button", { name: "反馈" }));
    fireEvent.change(screen.getByLabelText("问题描述"), { target: { value: "很好用" } });
    fireEvent.click(screen.getByRole("button", { name: "提交反馈" }));

    await screen.findByText("感谢反馈，我们会尽快查看");
  });

  it("shows inline error when submission fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 500, json: async () => ({}) }));
    render(<FeedbackWidget />);
    fireEvent.click(screen.getByRole("button", { name: "反馈" }));
    fireEvent.change(screen.getByLabelText("问题描述"), { target: { value: "测试" } });
    fireEvent.click(screen.getByRole("button", { name: "提交反馈" }));

    await screen.findByRole("alert");
  });

  it("moves with pointer drag and persists the position", () => {
    render(<FeedbackWidget />);
    const button = screen.getByRole("button", { name: "反馈" });
    mockRect(button, { left: 900, top: 600, width: 80, height: 36 });

    fireEvent.pointerDown(button, { clientX: 920, clientY: 618 });
    fireEvent.pointerMove(button, { clientX: 500, clientY: 400 });
    fireEvent.pointerUp(button, { clientX: 500, clientY: 400 });

    // drag to (480, 382), released right of center -> snapped to right edge
    expect(button.style.left).toBe("932px");
    expect(button.style.top).toBe("382px");
    expect(JSON.parse(localStorage.getItem("feedback-widget-pos") ?? "null")).toEqual({
      x: 932,
      y: 382,
    });
  });

  it("does not open the dialog after a drag", () => {
    render(<FeedbackWidget />);
    const button = screen.getByRole("button", { name: "反馈" });
    mockRect(button, { left: 900, top: 600, width: 80, height: 36 });

    fireEvent.pointerDown(button, { clientX: 920, clientY: 618 });
    fireEvent.pointerMove(button, { clientX: 500, clientY: 400 });
    fireEvent.pointerUp(button, { clientX: 500, clientY: 400 });
    fireEvent.click(button);

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens the dialog on a simple tap without movement", () => {
    render(<FeedbackWidget />);
    const button = screen.getByRole("button", { name: "反馈" });
    mockRect(button, { left: 900, top: 600, width: 80, height: 36 });

    fireEvent.pointerDown(button, { clientX: 920, clientY: 618 });
    fireEvent.pointerUp(button, { clientX: 920, clientY: 618 });
    fireEvent.click(button);

    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("restores the position from localStorage", () => {
    localStorage.setItem("feedback-widget-pos", JSON.stringify({ x: 12, y: 300 }));
    render(<FeedbackWidget />);
    const button = screen.getByRole("button", { name: "反馈" });

    expect(button.style.left).toBe("12px");
    expect(button.style.top).toBe("300px");
  });

  it("snaps to the left edge when released on the left half", () => {
    render(<FeedbackWidget />);
    const button = screen.getByRole("button", { name: "反馈" });
    mockRect(button, { left: 900, top: 600, width: 80, height: 36 });

    fireEvent.pointerDown(button, { clientX: 920, clientY: 618 });
    fireEvent.pointerMove(button, { clientX: 100, clientY: 300 });
    fireEvent.pointerUp(button, { clientX: 100, clientY: 300 });

    expect(button.style.left).toBe("12px");
  });
});
