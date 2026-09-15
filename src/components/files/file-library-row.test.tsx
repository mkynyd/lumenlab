import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FileLibraryRow } from "@/components/files/file-library-row";
import type { FileLibraryItem } from "@/lib/api/types";

function makeFile(overrides: Partial<FileLibraryItem> = {}): FileLibraryItem {
  return {
    id: "file-1",
    originalName: "数据结构讲义.md",
    filename: "stored-1.md",
    mimeType: "text/markdown",
    size: 2048,
    status: "parsed",
    category: "讲义",
    categoryConfidence: 1,
    projectId: "project-1",
    projectName: "408 复习",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: new Date().toISOString(),
    hasParsedContent: true,
    hasEnhancedContent: false,
    warningCount: 0,
    embeddingStatus: "complete",
    matchKind: null,
    snippet: null,
    ...overrides,
  };
}

function renderRow(file: FileLibraryItem, extra: Record<string, unknown> = {}) {
  const handlers = {
    onPreview: vi.fn(),
    onReparse: vi.fn(),
    onDelete: vi.fn(),
    ...extra,
  };
  render(<FileLibraryRow file={file} {...handlers} />);
  return handlers;
}

describe("FileLibraryRow", () => {
  it("展示文件名、项目、分类与大小的主要层级", () => {
    renderRow(makeFile());

    expect(screen.getByText("数据结构讲义.md")).toBeInTheDocument();
    expect(screen.getByText("408 复习")).toBeInTheDocument();
    expect(screen.getByText("讲义")).toBeInTheDocument();
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
    expect(screen.getByText("已解析")).toBeInTheDocument();
  });

  it("没有归属项目时给出明确说明而不是留空", () => {
    renderRow(makeFile({ projectId: null, projectName: null }));

    expect(screen.getByText("未归属项目")).toBeInTheDocument();
  });

  it("解析失败优先于其它状态展示", () => {
    renderRow(makeFile({ status: "failed", warningCount: 3, embeddingStatus: "partial" }));

    expect(screen.getByText("解析失败")).toBeInTheDocument();
    expect(screen.queryByText("有警告")).not.toBeInTheDocument();
  });

  it("解析中与已解析区分开", () => {
    renderRow(makeFile({ status: "parsing" }));

    expect(screen.getByText("解析中")).toBeInTheDocument();
  });

  it("有警告与索引不完整是两种状态，不合并", () => {
    const { unmount } = render(
      <FileLibraryRow
        file={makeFile({ warningCount: 2 })}
        onPreview={vi.fn()}
        onReparse={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(screen.getByText("有警告")).toBeInTheDocument();
    unmount();

    renderRow(makeFile({ embeddingStatus: "partial" }));
    expect(screen.getByText("索引不完整")).toBeInTheDocument();
  });

  it("点击整行打开预览，正文命中额外展示上下文片段", async () => {
    const user = userEvent.setup();
    const handlers = renderRow(
      makeFile({ matchKind: "content", snippet: "…线性表的顺序存储…" })
    );

    expect(screen.getByText("…线性表的顺序存储…")).toBeInTheDocument();
    await user.click(screen.getByText("数据结构讲义.md"));
    expect(handlers.onPreview).toHaveBeenCalledWith(
      expect.objectContaining({ id: "file-1" })
    );
  });

  it("勾选状态可键盘操作并回传选中项", async () => {
    const user = userEvent.setup();
    const onSelectedChange = vi.fn();
    renderRow(makeFile(), { onSelectedChange });

    const checkbox = screen.getByLabelText("选择 数据结构讲义.md");
    await user.click(checkbox);

    expect(onSelectedChange).toHaveBeenCalledWith(
      expect.objectContaining({ id: "file-1" }),
      true
    );
  });

  it("命中词在文件名中高亮", () => {
    renderRow(makeFile({ originalName: "线性代数复习.md", matchKind: "filename" }), {
      query: "代数",
    });

    const mark = screen.getByText("代数");
    expect(mark.tagName).toBe("MARK");
  });

  it("行尾菜单提供查看、下载与删除", async () => {
    const user = userEvent.setup();
    renderRow(makeFile());

    await user.click(screen.getByLabelText("数据结构讲义.md 的更多操作"));

    expect(await screen.findByText("查看")).toBeInTheDocument();
    expect(screen.getByText("下载原件")).toBeInTheDocument();
    expect(screen.getByText("重新解析")).toBeInTheDocument();
    expect(screen.getByText("删除")).toBeInTheDocument();
  });
});
