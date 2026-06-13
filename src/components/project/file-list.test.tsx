import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FileList } from "@/components/project/file-list";

describe("FileList", () => {
  it("exposes file selection as a keyboard-accessible checkbox", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();

    render(
      <FileList
        files={[
          {
            id: "file-1",
            filename: "stored.txt",
            originalName: "实验数据.txt",
            mimeType: "text/plain",
            size: 128,
            status: "parsed",
            createdAt: new Date().toISOString(),
          },
        ]}
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
    expect(onToggle).toHaveBeenCalledWith("file-1");
  });
});
