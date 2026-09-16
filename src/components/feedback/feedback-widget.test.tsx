import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FeedbackWidget } from "@/components/feedback/feedback-widget";

describe("FeedbackWidget", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 201 }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function openFeedback() {
    render(<FeedbackWidget />);
    fireEvent.click(screen.getByRole("button", { name: "反馈" }));
  }

  it("opens Feedback 1 from a viewport-anchored button outside the workbench stacking context", () => {
    localStorage.setItem("feedback-widget-pos", JSON.stringify({ x: 12, y: 300 }));
    render(<FeedbackWidget />);
    const button = screen.getByRole("button", { name: "反馈" });
    expect(button.parentElement).toBe(document.body);
    expect(button).toHaveClass("fixed", "right-4");
    expect(button.style.left).toBe("");
    fireEvent.click(button);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "发送反馈" })).toBeInTheDocument();
    expect(localStorage.getItem("feedback-widget-pos")).toBeTruthy();
  });

  it("submits category, content, contact and current path through the existing API", async () => {
    openFeedback();
    fireEvent.click(screen.getByRole("radio", { name: "建议" }));
    fireEvent.change(screen.getByLabelText("反馈内容"), { target: { value: "希望改进导出" } });
    fireEvent.change(screen.getByLabelText("联系方式（选填）"), { target: { value: "  example@qq.com  " } });
    fireEvent.click(screen.getByRole("button", { name: "发送反馈" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/feedback");
    expect(JSON.parse(init.body as string)).toMatchObject({
      category: "suggestion",
      content: "希望改进导出",
      contact: "example@qq.com",
      pagePath: window.location.pathname,
    });
  });

  it("requires content and never claims a screenshot was attached", () => {
    openFeedback();
    expect(screen.getByRole("button", { name: "发送反馈" })).toBeDisabled();
    expect(screen.getByText(/不会自动采集页面内容或截图/)).toBeInTheDocument();
    expect(screen.queryByText(/已附截图/)).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shows the sent state only after a successful response and can start another", async () => {
    openFeedback();
    fireEvent.change(screen.getByLabelText("反馈内容"), { target: { value: "很好用" } });
    fireEvent.click(screen.getByRole("button", { name: "发送反馈" }));

    expect(await screen.findByText("反馈已发送")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "再写一条" }));
    expect(screen.getByLabelText("反馈内容")).toHaveValue("");
  });

  it("preserves the draft and shows an inline error when submission fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    openFeedback();
    fireEvent.change(screen.getByLabelText("反馈内容"), { target: { value: "导出失败" } });
    fireEvent.click(screen.getByRole("button", { name: "发送反馈" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("提交失败");
    expect(screen.getByLabelText("反馈内容")).toHaveValue("导出失败");
  });

  it("resets the form after closing and reopening", () => {
    openFeedback();
    fireEvent.change(screen.getByLabelText("反馈内容"), { target: { value: "草稿" } });
    fireEvent.click(screen.getByRole("button", { name: "关闭反馈" }));
    fireEvent.click(screen.getByRole("button", { name: "反馈" }));
    expect(screen.getByLabelText("反馈内容")).toHaveValue("");
  });

  it("ignores a late response after the dialog was closed", async () => {
    let resolveResponse!: (value: { ok: boolean; status: number }) => void;
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise((resolve) => { resolveResponse = resolve; })));
    openFeedback();
    fireEvent.change(screen.getByLabelText("反馈内容"), { target: { value: "稍后关闭" } });
    fireEvent.click(screen.getByRole("button", { name: "发送反馈" }));
    fireEvent.click(screen.getByRole("button", { name: "关闭反馈" }));
    resolveResponse({ ok: true, status: 201 });

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "反馈" }));
    expect(screen.getByLabelText("反馈内容")).toHaveValue("");
    expect(screen.queryByText("反馈已发送")).not.toBeInTheDocument();
  });
});
