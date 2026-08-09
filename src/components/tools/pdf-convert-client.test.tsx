import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/hooks/use-conversions", () => ({
  useConversions: () => ({ data: [], isPending: false }),
}));
vi.mock("@/components/tools/save-to-project-dialog", () => ({
  SaveToProjectDialog: () => null,
}));
vi.mock("@/components/markdown/markdown-content", () => ({
  MarkdownContent: ({ content }: { content: string }) => <div>{content}</div>,
}));

import { PdfConvertClient } from "@/components/tools/pdf-convert-client";

function renderClient() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PdfConvertClient conversions={[]} />
    </QueryClientProvider>
  );
}

describe("PdfConvertClient", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          `data: ${JSON.stringify({
            stage: "done",
            content: "# 转换完成",
            conversionId: "conversion-1",
            fileName: "扫描文稿.md",
            assets: [],
          })}\n\n`,
          { status: 200, headers: { "Content-Type": "text/event-stream" } }
        )
      )
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("marks the fourth step complete, then dismisses the finished progress", async () => {
    const { container } = renderClient();
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();

    await act(async () => {
      fireEvent.change(input!, {
        target: {
          files: [new File(["pdf"], "扫描文稿.pdf", { type: "application/pdf" })],
        },
      });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole("heading", { name: "转换结果" })).toBeInTheDocument();
    expect(screen.getByLabelText("完成步骤已完成")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "转换进度" })).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1_600));

    expect(screen.queryByRole("region", { name: "转换进度" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "转换结果" })).toBeInTheDocument();
  });

  function stubFailedStream(payload: Record<string, unknown>) {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(`data: ${JSON.stringify(payload)}\n\n`, {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          })
      )
    );
  }

  async function selectPdf(container: HTMLElement) {
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    await act(async () => {
      fireEvent.change(input!, {
        target: {
          files: [new File(["pdf"], "讲义.pdf", { type: "application/pdf" })],
        },
      });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    return input!;
  }

  it("shows the mapped Chinese message for a failed event with a known code", async () => {
    stubFailedStream({
      stage: "failed",
      error: "queue is full",
      code: "-60009",
    });
    const { container } = renderClient();

    await selectPdf(container);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("队列已满，请稍后重试");
    expect(alert).not.toHaveTextContent("queue is full");
  });

  it("shows the generic Chinese message for a failed event with an unknown code", async () => {
    stubFailedStream({
      stage: "failed",
      error: "model inference failed: out of memory",
      code: "-69999",
    });
    const { container } = renderClient();

    await selectPdf(container);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("解析失败，请检查文件后重试");
    expect(alert).not.toHaveTextContent("out of memory");
  });

  it("maps non-stream error responses by code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: "MinerU 服务异常，请稍后重试", code: "-10001" },
          { status: 500 }
        )
      )
    );
    const { container } = renderClient();

    await selectPdf(container);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "MinerU 服务异常，请稍后重试"
    );
  });

  it("opens the file picker when clicking 选择其他文件 after an error", async () => {
    stubFailedStream({
      stage: "failed",
      error: "queue is full",
      code: "-60009",
    });
    const { container } = renderClient();
    const input = await selectPdf(container);
    expect(screen.getByRole("alert")).toBeInTheDocument();

    const clickSpy = vi
      .spyOn(HTMLInputElement.prototype, "click")
      .mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: "选择其他文件" }));

    // reset 先清空 input value，再打开文件选择器
    expect(input.value).toBe("");
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
