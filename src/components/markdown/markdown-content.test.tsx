import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownContent } from "./markdown-content";

const MD = "正文引用[^1]。再次引用[^1]。\n\n[^1]: 来源说明";

describe("MarkdownContent 脚注引用", () => {
  it("引用链接 href 与脚注定义 id 保持一致（sanitize 不双重加前缀）", () => {
    const { container } = render(<MarkdownContent content={MD} />);

    const firstRef = container.querySelector("sup a");
    const href = firstRef?.getAttribute("href");
    expect(href).toMatch(/^#.*user-content-fn-1$/);
    // href 指向的脚注定义必须真实存在，否则点击跳转无效
    expect(container.querySelector(`[id="${href!.slice(1)}"]`)).not.toBeNull();

    // 脚注定义里的回链也必须能找回引用锚点
    const backref = container.querySelector('[id$="user-content-fn-1"] a');
    const backrefHref = backref?.getAttribute("href");
    expect(backrefHref).toMatch(/^#.*user-content-fnref-1/);
    expect(
      container.querySelector(`[id="${backrefHref!.slice(1)}"]`)
    ).not.toBeNull();
  });

  it("多个实例的脚注 id 互相隔离，跳转不会串到其他消息", () => {
    const { container } = render(
      <>
        <MarkdownContent content={MD} />
        <MarkdownContent content={MD} />
      </>
    );

    const definitions = container.querySelectorAll('[id$="user-content-fn-1"]');
    expect(definitions).toHaveLength(2);
    expect(new Set(Array.from(definitions, (el) => el.id)).size).toBe(2);

    // 每个实例内部的引用都必须指向本实例内的脚注
    for (const root of Array.from(container.children)) {
      const href = root.querySelector("sup a")?.getAttribute("href");
      expect(href).toBeTruthy();
      expect(root.querySelector(`[id="${href!.slice(1)}"]`)).not.toBeNull();
    }
  });
});

describe("MarkdownContent 结构化输出", () => {
  it("把围栏代码渲染为带语言标签和复制操作的独立代码块", () => {
    const { container, getByRole } = render(
      <MarkdownContent content={'```ts\nconst answer = 42;\n```'} />
    );

    expect(container.querySelector(".markdown-code-block")).not.toBeNull();
    expect(container.querySelector("pre pre")).toBeNull();
    expect(container.textContent).toContain("TypeScript");
    expect(getByRole("button", { name: "复制代码" })).toBeTruthy();
  });

  it("为表格提供独立横向滚动容器", () => {
    const { container } = render(
      <MarkdownContent content={'| A | B |\n| - | - |\n| 1 | 2 |'} />
    );

    expect(container.querySelector(".markdown-table-wrap > table")).not.toBeNull();
  });
});
