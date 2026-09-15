import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  useGlobalSearch: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));
vi.mock("@/lib/hooks/use-global-search", () => ({
  useGlobalSearch: mocks.useGlobalSearch,
}));

import { GlobalSearchDialog } from "./global-search-dialog";

const results = [
  {
    id: "chat-1",
    type: "conversation" as const,
    title: "数学复习",
    subtitle: "对话",
    snippet: "把高等数学重点整理成清单",
    href: "/chat/chat-1",
    updatedAt: "2026-09-16T08:00:00.000Z",
  },
  {
    id: "file-1",
    type: "document" as const,
    title: "数学讲义.pdf",
    subtitle: "期末复习",
    snippet: null,
    href: "/files/file-1",
    updatedAt: "2026-09-15T08:00:00.000Z",
    mimeType: "application/pdf",
  },
];

describe("GlobalSearchDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useGlobalSearch.mockReturnValue({
      data: {
        query: "数学",
        results,
        counts: { conversation: 1, image: 0, document: 1, project: 0 },
      },
      isFetching: false,
      isError: false,
      refetch: vi.fn(),
    });
  });

  it("keeps the empty state compact and only expands after typing", () => {
    render(<GlobalSearchDialog open onOpenChange={vi.fn()} />);

    const dialog = screen.getByRole("dialog", { name: "全局搜索" });
    expect(dialog).toHaveClass("h-auto");
    expect(dialog).not.toHaveClass("h-[min(82dvh,42rem)]");

    fireEvent.change(screen.getByRole("textbox", { name: "全局搜索" }), {
      target: { value: "数学" },
    });

    expect(dialog).toHaveClass("h-[min(82dvh,42rem)]");
    expect(dialog).not.toHaveClass("h-auto");
  });

  it("renders the reference categories and filters result rows", () => {
    render(<GlobalSearchDialog open onOpenChange={vi.fn()} />);

    const input = screen.getByRole("textbox", { name: "全局搜索" });
    fireEvent.change(input, { target: { value: "数学" } });

    expect(screen.getByRole("tab", { name: "全部" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "对话" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "图片" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "文档" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "项目" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "文档" }));
    expect(screen.getByRole("option", { name: /数学讲义/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /数学复习/ })).not.toBeInTheDocument();
  });

  it("closes and navigates when a result is selected", () => {
    const onOpenChange = vi.fn();
    render(<GlobalSearchDialog open onOpenChange={onOpenChange} />);
    fireEvent.change(screen.getByRole("textbox", { name: "全局搜索" }), {
      target: { value: "数学" },
    });

    fireEvent.click(screen.getByRole("option", { name: /数学复习/ }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mocks.push).toHaveBeenCalledWith("/chat/chat-1");
  });

  it("supports arrow-key selection and Enter navigation", () => {
    render(<GlobalSearchDialog open onOpenChange={vi.fn()} />);
    const input = screen.getByRole("textbox", { name: "全局搜索" });
    fireEvent.change(input, { target: { value: "数学" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(mocks.push).toHaveBeenCalledWith("/files/file-1");
  });
});
