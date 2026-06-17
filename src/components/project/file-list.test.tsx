import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FileList } from "@/components/project/file-list";

describe("FileList", () => {
  const files = [
    {
      id: "file-1",
      filename: "stored-1.txt",
      originalName: "实验数据.txt",
      mimeType: "text/plain",
      size: 128,
      status: "parsed",
      createdAt: new Date().toISOString(),
    },
    {
      id: "file-2",
      filename: "stored-2.pdf",
      originalName: "实验讲义.pdf",
      mimeType: "application/pdf",
      size: 2048,
      status: "parsing",
      processingMetadata: { parsingStage: "model" },
      createdAt: new Date().toISOString(),
    },
  ];

  it("exposes file selection as a keyboard-accessible checkbox", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();

    render(
      <FileList
        files={[files[0]]}
        selectedIds={new Set()}
        onToggle={onToggle}
      />
    );

    const fileOption = screen.getByRole("checkbox", {
      name: "选择文件 实验数据.txt",
    });
    expect(fileOption).not.toBeChecked();

    fileOption.focus();
    await user.keyboard("{Enter}");
    expect(onToggle).toHaveBeenCalledWith(
      "file-1",
      expect.objectContaining({ range: false, additive: false })
    );
  });

  it("passes range and additive selection intent to the parent", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();

    render(
      <FileList
        files={files}
        selectedIds={new Set()}
        onToggle={onToggle}
      />
    );

    await user.click(screen.getByRole("checkbox", { name: "选择文件 实验数据.txt" }));
    await user.keyboard("{Shift>}");
    await user.click(screen.getByRole("checkbox", { name: "选择文件 实验讲义.pdf" }));
    await user.keyboard("{/Shift}");

    expect(onToggle).toHaveBeenLastCalledWith(
      "file-2",
      expect.objectContaining({ range: true, additive: false })
    );
  });

  it("renders uploaded files as compact selectable rows", () => {
    render(
      <FileList
        files={files}
        selectedIds={new Set()}
        onToggle={vi.fn()}
      />
    );

    expect(screen.getByRole("checkbox", { name: "选择文件 实验讲义.pdf" })).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
});
