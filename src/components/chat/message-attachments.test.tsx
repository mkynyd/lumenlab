import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ChatAttachmentDto } from "@/lib/chat/message-attachments";
import { MessageAttachments } from "./message-attachments";

function dto(overrides: Partial<ChatAttachmentDto> = {}): ChatAttachmentDto {
  return {
    id: `att-${Math.random().toString(36).slice(2)}`,
    kind: "image",
    name: "photo.png",
    mimeType: "image/png",
    size: 1024,
    width: null,
    height: null,
    status: "bound",
    url: "/api/chat/attachments/att-1?variant=original",
    thumbnailUrl: "/api/chat/attachments/att-1",
    ...overrides,
  };
}

describe("MessageAttachments", () => {
  it("文件附件渲染为卡片：文件名、格式化大小、打开与下载链接", () => {
    const { container } = render(
      <MessageAttachments
        attachments={[
          dto({
            kind: "file",
            name: "data.xlsx",
            mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            size: 1536,
          }),
        ]}
      />
    );

    expect(screen.getByText("data.xlsx")).toBeInTheDocument();
    expect(screen.getByText("1.5 KB")).toBeInTheDocument();
    const openLinks = screen.getAllByRole("link", { name: "打开 data.xlsx" });
    expect(openLinks.length).toBeGreaterThan(0);
    expect(openLinks[0]).toHaveAttribute("target", "_blank");
    const download = screen.getByRole("link", { name: "下载 data.xlsx" });
    expect(download).toHaveAttribute("download", "data.xlsx");
    // 文件卡片不得出现在媒体网格里。
    expect(container.querySelector("img")).toBeNull();
  });

  it("视频附件渲染 video 首帧缩略图，点击图片路径不受影响", () => {
    render(
      <MessageAttachments
        attachments={[
          dto({
            kind: "video",
            name: "clip.mp4",
            mimeType: "video/mp4",
            size: 50 * 1024 * 1024,
          }),
        ]}
      />
    );

    const video = document.querySelector("video");
    expect(video).not.toBeNull();
    expect(video).toHaveAttribute("preload", "metadata");
    // React 把 muted 写成 DOM property 而不是属性，断言要读 property。
    expect(video?.muted).toBe(true);
    expect(video).toHaveAttribute("playsInline");
    expect(video).toHaveAttribute("src", "/api/chat/attachments/att-1");
    expect(screen.getByRole("button", { name: "查看视频 clip.mp4" })).toBeInTheDocument();
  });

  it("视频查看器渲染 controls 视频，隐藏缩放控件，提供打开原文件", () => {
    render(
      <MessageAttachments
        attachments={[
          dto({
            kind: "video",
            name: "clip.mp4",
            mimeType: "video/mp4",
            size: 1024,
          }),
        ]}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "查看视频 clip.mp4" }));

    const dialog = screen.getByRole("dialog");
    const video = dialog.querySelector("video");
    expect(video).not.toBeNull();
    expect(video).toHaveAttribute("controls");
    expect(video).toHaveAttribute("autoPlay");
    expect(within(dialog).queryByRole("button", { name: "缩小" })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "放大" })).toBeNull();
    expect(
      within(dialog).getByRole("link", { name: "打开原文件" })
    ).toHaveAttribute("target", "_blank");
  });

  it("PDF 文件卡片点击后内联预览，其他文件卡片新标签打开", () => {
    render(
      <MessageAttachments
        attachments={[
          dto({
            kind: "file",
            name: "report.pdf",
            mimeType: "application/pdf",
            size: 2048,
          }),
          dto({
            id: "att-zip",
            kind: "file",
            name: "bundle.zip",
            mimeType: "application/zip",
            size: 2048,
            url: "/api/chat/attachments/att-zip?variant=original",
            thumbnailUrl: "/api/chat/attachments/att-zip",
          }),
        ]}
      />
    );

    // PDF：中间区域是预览按钮而不是外链。
    expect(
      screen.getByRole("button", { name: "预览 report.pdf" })
    ).toBeInTheDocument();
    // 其他文件：中间区域是新标签链接。
    expect(
      screen.getByRole("link", { name: "打开 bundle.zip" })
    ).toHaveAttribute("target", "_blank");

    fireEvent.click(screen.getByRole("button", { name: "预览 report.pdf" }));
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByTitle("report.pdf")
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("link", { name: "打开原文件" })
    ).toBeInTheDocument();
  });

  it("uploading 状态的文件卡片只展示信息与 spinner，不渲染任何可操作入口", () => {
    render(
      <MessageAttachments
        attachments={[
          dto({
            kind: "file",
            name: "draft.docx",
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            size: 512,
            status: "uploading",
            url: "",
            thumbnailUrl: "",
          }),
        ]}
      />
    );

    // 上传中没有可用 URL：既不能出现 href="" 的假链接，也不能出现下载入口。
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByText("draft.docx")).toBeInTheDocument();
    expect(screen.getByText("512 B")).toBeInTheDocument();
    // spinner 可见，卡片整体降不透明度表示处理中。
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(document.querySelector(".opacity-60")).not.toBeNull();
  });

  it("uploading 状态的视频缩略图沿用半透明 spinner 遮罩", () => {
    render(
      <MessageAttachments
        attachments={[
          dto({
            kind: "video",
            name: "uploading.mp4",
            mimeType: "video/mp4",
            status: "uploading",
          }),
        ]}
      />
    );

    const button = screen.getByRole("button", { name: "查看视频 uploading.mp4" });
    expect(button.querySelector('[class*="bg-[var(--color-overlay)]"]')).not.toBeNull();
  });

  it("多张图片仍按网格渲染，单张不进网格", () => {
    const images = [
      dto({ id: "img-1" }),
      dto({ id: "img-2" }),
      dto({ id: "img-3" }),
    ];
    const { container, unmount } = render(
      <MessageAttachments attachments={images} />
    );
    expect(container.querySelectorAll("img")).toHaveLength(3);
    expect(container.querySelector(".grid")).not.toBeNull();
    unmount();

    const single = render(<MessageAttachments attachments={[dto({ id: "img-4" })]} />);
    expect(single.container.querySelector(".grid")).toBeNull();
    expect(single.container.querySelector("img")).not.toBeNull();
    single.unmount();
  });

  it("媒体与文件混合时网格在上、卡片在下", () => {
    const { container } = render(
      <MessageAttachments
        attachments={[
          dto({ id: "img-1", kind: "image", name: "a.png" }),
          dto({
            id: "file-1",
            kind: "file",
            name: "b.txt",
            mimeType: "text/plain",
            size: 100,
          }),
          dto({
            id: "vid-1",
            kind: "video",
            name: "c.mp4",
            mimeType: "video/mp4",
          }),
        ]}
      />
    );

    expect(container.querySelectorAll("img")).toHaveLength(1);
    expect(container.querySelectorAll("video")).toHaveLength(1);
    expect(screen.getByText("b.txt")).toBeInTheDocument();
    // 网格容器（媒体）出现在文件卡片之前。
    const grid = container.querySelector(".grid");
    const card = screen.getByText("b.txt").closest("div[class*='rounded-']");
    expect(
      grid && card ? grid.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING : false
    ).toBeTruthy();
  });
});
