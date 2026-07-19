import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/chat/mermaid-block", () => ({
  MermaidBlock: ({ code }: { code: string }) => <div data-testid="mermaid">{code}</div>,
}));

vi.mock("@/components/markdown/lumenflow-diagram", () => ({
  LumenFlowDiagram: ({ code }: { code: string }) => <div data-testid="lumenflow">{code}</div>,
}));

import { MarkdownContent } from "@/components/markdown/markdown-content";

describe("MarkdownContent", () => {
  it("uses the complete Markdown surface and resolves relative image URLs", () => {
    const { container } = render(
      <MarkdownContent
        content={[
          "# 电路题",
          "",
          "![串联电路](pics/circuit.png)",
          "",
          "| 元件 | 数值 |",
          "| --- | --- |",
          "| R | 10Ω |",
          "",
          "```mermaid",
          "graph LR; A-->B",
          "```",
          "",
          "```lumenflow",
          '{"nodes":[{"id":"a","label":"开始"}],"edges":[]}',
          "```",
        ].join("\n")}
        resolveImageUrl={(src) => `/assets/${src}`}
      />
    );

    expect(container.firstChild).toHaveClass("workbench-readable", "markdown-body");
    expect(screen.getByRole("heading", { name: "电路题" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "串联电路" })).toHaveAttribute(
      "src",
      "/assets/pics/circuit.png"
    );
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByTestId("mermaid")).toHaveTextContent("graph LR; A-->B");
    expect(screen.getByTestId("lumenflow")).toHaveTextContent('"开始"');
  });

  it("renders sanitized HTML tables emitted by document conversion", () => {
    render(
      <MarkdownContent
        content={[
          "转换后的表格：",
          "",
          '<table><tbody><tr><th rowspan="2">字母</th><th>a</th><th>b</th></tr><tr><td>0</td><td>1</td></tr></tbody></table>',
          "",
          "字符检查：Ω · → · 中文",
          "",
          '<script>window.__unsafeMarkdown = true</script>',
        ].join("\n")}
      />
    );

    const table = screen.getByRole("table");
    expect(table).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "字母" })).toHaveAttribute(
      "rowspan",
      "2"
    );
    expect(screen.getByText("字符检查：Ω · → · 中文")).toBeInTheDocument();
    expect(document.querySelector("script")).not.toBeInTheDocument();
  });
});
