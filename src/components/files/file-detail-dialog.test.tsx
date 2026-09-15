import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FileDetailDialog,
  type FileDetailTarget,
} from "@/components/files/file-detail-dialog";

const BASE_FILE: FileDetailTarget = {
  id: "file-1",
  originalName: "数据结构讲义.pdf",
  mimeType: "application/pdf",
  size: 2048,
  status: "parsed",
  projectId: "project-1",
  projectName: "408 复习",
  category: "讲义",
};

function detailResponse(overrides: Record<string, unknown> = {}) {
  return {
    file: {
      id: "file-1",
      originalName: "数据结构讲义.pdf",
      mimeType: "application/pdf",
      size: 2048,
      status: "parsed",
      category: "讲义",
      textContent: "# 线性表\n\n顺序表与链表。",
      processingMetadata: { parser: "minimax-pdf-vision", embeddingStatus: "complete" },
      projectId: "project-1",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-02T00:00:00.000Z",
      resources: [],
      ...overrides,
    },
  };
}

function renderDialog(file: FileDetailTarget = BASE_FILE, detail = detailResponse()) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify(detail), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    )
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <FileDetailDialog file={file} onClose={vi.fn()} />
    </QueryClientProvider>
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FileDetailDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("默认展示解析内容而不是原件", async () => {
    renderDialog();

    expect(await screen.findByText("线性表")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "解析内容" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(screen.getByText("408 复习 · 讲义 · 2.0 KB · 已解析")).toBeInTheDocument();
  });

  it("元信息里的措辞是解析内容，不再出现 OCR 原文", async () => {
    renderDialog();
    await screen.findByText("线性表");

    expect(screen.getByRole("button", { name: "手工修订解析内容" })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("OCR 原文");
  });

  it("没有 AI 整理内容时不出现二级切换", async () => {
    renderDialog();

    await screen.findByText("线性表");
    expect(screen.queryByRole("tab", { name: "AI 整理" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "基础解析" })).not.toBeInTheDocument();
  });

  it("存在 AI 整理内容时,二级切换按需拉取", async () => {
    const user = userEvent.setup();
    renderDialog(BASE_FILE, detailResponse({ enhancementStatus: "enhanced", hasEnhancedContent: true }));

    await screen.findByText("线性表");
    const enhancedTab = screen.getByRole("tab", { name: "AI 整理" });
    await user.click(enhancedTab);

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "AI 整理" })).toHaveAttribute(
        "aria-selected",
        "true"
      );
    });
  });

  it("PDF 原件用内嵌查看器打开同源接口", async () => {
    const user = userEvent.setup();
    renderDialog();
    await screen.findByText("线性表");

    await user.click(screen.getByRole("tab", { name: "原始文件" }));

    const frame = await screen.findByTitle("数据结构讲义.pdf 原件");
    expect(frame.tagName).toBe("IFRAME");
    expect(frame).toHaveAttribute("src", "/api/files/file-1/content");
  });

  it("图片原件用自适应图片查看器", async () => {
    const user = userEvent.setup();
    renderDialog(
      { ...BASE_FILE, originalName: "截图.png", mimeType: "image/png" },
      detailResponse({ mimeType: "image/png", originalName: "截图.png" })
    );
    await screen.findByText("线性表");

    await user.click(screen.getByRole("tab", { name: "原始文件" }));

    const image = await screen.findByAltText("截图.png 原件");
    expect(image.tagName).toBe("IMG");
    expect(image).toHaveAttribute("src", "/api/files/file-1/content");
  });

  it("Office 文档明确说明无法在线预览并给出下载入口", async () => {
    const user = userEvent.setup();
    renderDialog(
      {
        ...BASE_FILE,
        originalName: "课件.pptx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      },
      detailResponse({
        mimeType:
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        originalName: "课件.pptx",
      })
    );
    await screen.findByText("线性表");

    await user.click(screen.getByRole("tab", { name: "原始文件" }));

    expect(await screen.findByText("这类文件暂不支持在线预览")).toBeInTheDocument();
    const download = screen.getAllByRole("link", { name: /下载原件/ })[0];
    expect(download).toHaveAttribute("href", "/api/files/file-1/content?download=1");
  });

  it("解析质量默认折叠，展开后展示解析器与结构统计", async () => {
    const user = userEvent.setup();
    renderDialog();
    await screen.findByText("线性表");

    expect(screen.queryByText("解析器")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /解析质量/ }));

    expect(screen.getByText("解析器")).toBeInTheDocument();
    expect(screen.getByText("minimax-pdf-vision")).toBeInTheDocument();
    expect(screen.getByText("完整")).toBeInTheDocument();
  });
});
