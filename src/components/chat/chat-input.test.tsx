import { act, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileAttachment } from "@/lib/chat/router";
import { ChatInput } from "@/components/chat/chat-input";

function pasteFiles(textarea: HTMLElement, files: File[]) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { files, types: ["Files"] },
  });
  fireEvent(textarea, event);
}

function dropFiles(target: HTMLElement, files: File[]) {
  fireEvent.drop(target, {
    dataTransfer: { files, types: ["Files"] },
  });
}

describe("ChatInput", () => {
  beforeEach(() => {
    // jsdom 不提供 blob URL API；本地预览的创建/回收在这里打桩。
    URL.createObjectURL = vi.fn(() => "blob:mock-preview");
    URL.revokeObjectURL = vi.fn();
  });

  it("preserves draft and attachments on a failed send", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockResolvedValue(false);
    const onAttachmentsChange = vi.fn();
    render(<ChatInput onSend={onSend} onAttachmentsChange={onAttachmentsChange} />);
    await user.type(screen.getByRole("textbox"), "保留草稿{Enter}");
    await waitFor(() => expect(onSend).toHaveBeenCalled());
    expect(screen.getByRole("textbox")).toHaveValue("保留草稿");
    expect(onAttachmentsChange).not.toHaveBeenCalled();
  });

  it("blocks submission for unavailable models while leaving the selector usable", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const onModelChange = vi.fn();
    render(<ChatInput onSend={onSend} model="qwen3.8-flash" onModelChange={onModelChange}
      availableModels={["minimax-m3"]} blockedReason="Qwen 暂未开放" />);
    await user.type(screen.getByRole("textbox"), "草稿{Enter}");
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox")).toHaveValue("草稿");
    expect(screen.getByText("Qwen 暂未开放")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "选择模型" })[0]).toBeEnabled();
    expect(screen.getAllByRole("button", { name: "选择模型" })[0]).toHaveTextContent("Qwen3.8-Flash");
  });

  it("shows an externally filled prompt and lets the user edit it", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();

    render(
      <ChatInput
        value="请基于资料生成实验报告"
        onValueChange={onValueChange}
        onSend={vi.fn()}
      />
    );

    const input = screen.getByRole("textbox");
    expect(input).toHaveValue("请基于资料生成实验报告");

    await user.type(input, "，并标注缺失项");
    expect(onValueChange).toHaveBeenCalled();
  });

  it("gives the message editor an accessible name", () => {
    render(<ChatInput onSend={vi.fn()} />);

    expect(screen.getByRole("textbox", { name: "消息内容" })).toBeInTheDocument();
  });

  it("puts mobile-only secondary controls behind the compact action button", async () => {
    const user = userEvent.setup();
    const onModelChange = vi.fn();

    render(
      <ChatInput
        onSend={vi.fn()}
        model="deepseek-v4-pro"
        onModelChange={onModelChange}
        availableModels={["deepseek-v4-flash", "deepseek-v4-pro"]}
        onSkillChange={vi.fn()}
        onWebSearchToggle={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: "更多输入选项" }));

    const tools = await screen.findByRole("dialog", { name: "对话选项" });
    expect(within(tools).getByRole("button", { name: "文件" })).toBeInTheDocument();
    expect(within(tools).getByRole("button", { name: "联网" })).toBeInTheDocument();

    await user.click(within(tools).getByRole("button", { name: "DeepSeek V4 Flash" }));
    expect(onModelChange).toHaveBeenCalledWith("deepseek-v4-flash");
    // 选项变更不再自动关闭展开栏，由用户自行关闭
    expect(screen.getByRole("dialog", { name: "对话选项" })).toBeInTheDocument();
  });

  it("appends pasted image files as attachments with a local preview", () => {
    const onAttachmentsChange = vi.fn();
    render(<ChatInput onSend={vi.fn()} onAttachmentsChange={onAttachmentsChange} />);

    const file = new File(["pixel"], "截图.png", { type: "image/png" });
    pasteFiles(screen.getByRole("textbox"), [file]);

    expect(onAttachmentsChange).toHaveBeenCalledTimes(1);
    const next = onAttachmentsChange.mock.calls[0][0] as FileAttachment[];
    expect(next).toHaveLength(1);
    expect(next[0].name).toBe("截图.png");
    expect(next[0].previewUrl).toBe("blob:mock-preview");
  });

  it("rejects pasted files with disallowed extensions and shows a non-blocking notice", () => {
    const onAttachmentsChange = vi.fn();
    render(<ChatInput onSend={vi.fn()} onAttachmentsChange={onAttachmentsChange} />);

    const file = new File(["MZ"], "installer.exe", { type: "application/x-msdownload" });
    pasteFiles(screen.getByRole("textbox"), [file]);

    expect(onAttachmentsChange).not.toHaveBeenCalled();
    const notice = screen.getByRole("status");
    expect(notice).toHaveTextContent("installer.exe");
    expect(notice).toHaveTextContent("不支持的文件类型");
    // 提示非阻断：输入框仍可用
    expect(screen.getByRole("textbox")).toBeEnabled();
  });

  it("rejects pasted files over the per-file size limit", () => {
    const onAttachmentsChange = vi.fn();
    render(<ChatInput onSend={vi.fn()} onAttachmentsChange={onAttachmentsChange} />);

    const file = new File(["x"], "big.png", { type: "image/png" });
    Object.defineProperty(file, "size", { value: 60 * 1024 * 1024 });
    pasteFiles(screen.getByRole("textbox"), [file]);

    expect(onAttachmentsChange).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("超过 50MB 限制");
  });

  it("blocks a batch that would exceed the per-request attachment limit", () => {
    const onAttachmentsChange = vi.fn();
    const existing: FileAttachment[] = Array.from({ length: 50 }, (_, index) => ({
      id: `existing-${index}`,
      name: `资料-${index}.txt`,
      mimeType: "text/plain",
      size: 0,
      data: new File([], `资料-${index}.txt`, { type: "text/plain" }),
    }));
    render(
      <ChatInput
        onSend={vi.fn()}
        attachments={existing}
        onAttachmentsChange={onAttachmentsChange}
      />
    );

    const file = new File(["note"], "补充.txt", { type: "text/plain" });
    pasteFiles(screen.getByRole("textbox"), [file]);

    expect(onAttachmentsChange).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("单次最多上传 50 个文件");
  });

  it("accepts files dropped onto the composer dock", () => {
    const onAttachmentsChange = vi.fn();
    const { container } = render(
      <ChatInput onSend={vi.fn()} onAttachmentsChange={onAttachmentsChange} />
    );

    const dock = container.querySelector(".workbench-input-dock");
    expect(dock).not.toBeNull();
    const file = new File(["%PDF-1.4"], "实验指导.pdf", { type: "application/pdf" });
    dropFiles(dock as HTMLElement, [file]);

    expect(onAttachmentsChange).toHaveBeenCalledTimes(1);
    const next = onAttachmentsChange.mock.calls[0][0] as FileAttachment[];
    expect(next.map((attachment) => attachment.name)).toEqual(["实验指导.pdf"]);
    // 非图片不产生本地预览 URL
    expect(next[0].previewUrl).toBeUndefined();
  });
});

describe("ChatInput 非受控附件模式（深度研究入口）", () => {
  it("keeps pasted files as visible chips and sends them via onSend without onAttachmentsChange", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockResolvedValue(true);
    render(<ChatInput onSend={onSend} />);

    const file = new File(["data"], "资料.pdf", { type: "application/pdf" });
    pasteFiles(screen.getByRole("textbox"), [file]);

    // 附件 chip 可见且带删除按钮（ResearchComposer 不传受控回调时不能静默丢弃）。
    expect(screen.getByText("资料.pdf")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /移除.*资料\.pdf|资料\.pdf.*移除/ })).toBeInTheDocument();

    await user.type(screen.getByRole("textbox"), "研究这个问题{Enter}");
    await waitFor(() => expect(onSend).toHaveBeenCalled());
    const [, attachments] = onSend.mock.calls[0] as unknown as [string, FileAttachment[]];
    expect(attachments).toHaveLength(1);
    expect(attachments[0].name).toBe("资料.pdf");

    // 发送成功后内部附件清空。
    await waitFor(() => expect(screen.queryByText("资料.pdf")).not.toBeInTheDocument());
  });

  it("still clears internally held attachments after a successful send and keeps them on failure", async () => {
    const user = userEvent.setup();
    const failSend = vi.fn().mockResolvedValue(false);
    const { unmount } = render(<ChatInput onSend={failSend} />);
    pasteFiles(screen.getByRole("textbox"), [new File(["x"], "a.pdf", { type: "application/pdf" })]);
    expect(screen.getByText("a.pdf")).toBeInTheDocument();
    await user.type(screen.getByRole("textbox"), "hi{Enter}");
    await waitFor(() => expect(failSend).toHaveBeenCalled());
    expect(screen.getByText("a.pdf")).toBeInTheDocument();
    unmount();
  });
});

describe("ChatInput 附件部分接受（F-2）", () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => "blob:mock-preview");
    URL.revokeObjectURL = vi.fn();
  });

  it("keeps the legal files in a mixed batch and only rejects the oversized one", () => {
    const onAttachmentsChange = vi.fn();
    render(<ChatInput onSend={vi.fn()} onAttachmentsChange={onAttachmentsChange} />);

    const big = new File(["x"], "big.pdf", { type: "application/pdf" });
    Object.defineProperty(big, "size", { value: 60 * 1024 * 1024 });
    const note = new File(["note"], "note.txt", { type: "text/plain" });
    pasteFiles(screen.getByRole("textbox"), [big, note]);

    expect(onAttachmentsChange).toHaveBeenCalledTimes(1);
    const kept = onAttachmentsChange.mock.calls[0][0] as FileAttachment[];
    expect(kept.map((attachment) => attachment.name)).toEqual(["note.txt"]);
    const notice = screen.getByRole("status");
    expect(notice).toHaveTextContent("big.pdf");
    expect(notice).toHaveTextContent("超过 50MB 限制");
    // 合法文件仍在输入坞中可选中发送
    expect(screen.getByRole("textbox")).toBeEnabled();
  });

  it("partially accepts files up to the per-request total size ceiling", () => {
    const onAttachmentsChange = vi.fn();
    render(<ChatInput onSend={vi.fn()} onAttachmentsChange={onAttachmentsChange} />);

    // 单文件均 ≤50MB，但 7×50MB 超过单次 300MB 总上限：前 6 份保留，第 7 份单独拒绝。
    const files = Array.from({ length: 7 }, (_, index) => {
      const file = new File([`f${index}`], `part-${index}.pdf`, { type: "application/pdf" });
      Object.defineProperty(file, "size", { value: 50 * 1024 * 1024 });
      return file;
    });
    pasteFiles(screen.getByRole("textbox"), files);

    expect(onAttachmentsChange).toHaveBeenCalledTimes(1);
    const kept = onAttachmentsChange.mock.calls[0][0] as FileAttachment[];
    expect(kept.map((attachment) => attachment.name)).toEqual([
      "part-0.pdf",
      "part-1.pdf",
      "part-2.pdf",
      "part-3.pdf",
      "part-4.pdf",
      "part-5.pdf",
    ]);
    const notice = screen.getByRole("status");
    expect(notice).toHaveTextContent("part-6.pdf");
    expect(notice).toHaveTextContent("单次上传总大小超过 300MB 限制");
  });

  it("partially accepts files up to the per-request count ceiling", () => {
    const onAttachmentsChange = vi.fn();
    const existing: FileAttachment[] = Array.from({ length: 49 }, (_, index) => ({
      id: `existing-${index}`,
      name: `资料-${index}.txt`,
      mimeType: "text/plain",
      size: 0,
      data: new File([], `资料-${index}.txt`, { type: "text/plain" }),
    }));
    render(
      <ChatInput
        onSend={vi.fn()}
        attachments={existing}
        onAttachmentsChange={onAttachmentsChange}
      />
    );

    const one = new File(["1"], "one.txt", { type: "text/plain" });
    const two = new File(["2"], "two.txt", { type: "text/plain" });
    pasteFiles(screen.getByRole("textbox"), [one, two]);

    expect(onAttachmentsChange).toHaveBeenCalledTimes(1);
    const kept = onAttachmentsChange.mock.calls[0][0] as FileAttachment[];
    expect(kept).toHaveLength(50);
    expect(kept[49].name).toBe("one.txt");
    const notice = screen.getByRole("status");
    expect(notice).toHaveTextContent("two.txt");
    expect(notice).toHaveTextContent("单次最多上传 50 个文件");
  });
});

describe("ChatInput 发送幂等（F-3）", () => {
  it("does not enqueue a duplicate send from rapid consecutive submissions", async () => {
    let resolveSend: ((value: boolean) => void) | undefined;
    const onSend = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveSend = resolve;
        })
    );
    render(<ChatInput onSend={onSend} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "hi" } });

    // 同一同步批次内连按两次 Enter：第二次事件处理器读到的仍是
    // isSubmitting=false 的旧闭包，必须靠同步幂等闸挡住重复入队。
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSend).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSend?.(true);
    });
    await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue(""));
  });

  it("allows a new send after the previous one settles", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockResolvedValue(true);
    render(<ChatInput onSend={onSend} />);
    const input = screen.getByRole("textbox");

    await user.type(input, "第一条{Enter}");
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));

    await user.type(input, "第二条{Enter}");
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(2));
    expect(onSend.mock.calls[1][0]).toBe("第二条");
  });
});
