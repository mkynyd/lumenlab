import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { TextSelector } from "./text-selector";
vi.mock("@/components/markdown/markdown-content", () => ({ MarkdownContent: ({ content }: { content: string }) => <div>{content}</div> }));
it("submits only the native selection even without a React select event", async () => {
  const source = "第1题：$1+1$是多少？\nA.1 B.2\n\n第2题：不收录。";
  const submit = vi.fn().mockResolvedValue(undefined);
  render(<TextSelector source={source} onSubmit={submit} onCancel={() => {}} />);
  const field = screen.getByLabelText("Markdown 原文") as HTMLTextAreaElement;
  const end = source.indexOf("第2题");
  field.setSelectionRange(0, end);
  fireEvent.click(screen.getByRole("button", { name: "添加选中文本" }));
  fireEvent.click(screen.getByRole("button", { name: "仅收录已选 1 题" }));
  await waitFor(() => expect(submit).toHaveBeenCalledWith([{ ordinal: "1", ranges: [{ start: 0, end }] }]));
});
