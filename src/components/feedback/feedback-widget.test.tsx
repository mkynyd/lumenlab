import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FeedbackWidget } from "@/components/feedback/feedback-widget";

describe("FeedbackWidget", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ status: 201, json: async () => ({ id: "fb-1" }) })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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
});
