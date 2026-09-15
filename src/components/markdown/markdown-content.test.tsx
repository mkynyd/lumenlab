import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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

  it("点击脚注引用时阻止默认锚点跳转，只滚动最近的消息容器", () => {
    const { container } = render(
      <div style={{ overflowY: "auto" }}>
        <MarkdownContent content={MD} />
      </div>
    );
    const scroller = container.firstElementChild as HTMLElement;
    Object.defineProperty(scroller, "clientHeight", { value: 600 });
    const scrollTo = vi.fn();
    Object.defineProperty(scroller, "scrollTo", { value: scrollTo });
    Object.defineProperty(scroller, "scrollTop", { value: 0, writable: true });

    const firstRef = container.querySelector("sup a")!;
    const href = firstRef.getAttribute("href")!;
    expect(container.querySelector(`[id="${href.slice(1)}"]`)).not.toBeNull();

    fireEvent.click(firstRef);

    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo.mock.calls[0][0]).toMatchObject({ behavior: "smooth" });
    // hash 手动更新而非浏览器默认跳转
    expect(window.location.hash).toBe(href);
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

describe("MarkdownContent 数学公式", () => {
  it("\\frac{a}{b} 渲染为真实分式（MathML mfrac）", () => {
    const { container } = render(<MarkdownContent content={"$$\\frac{a}{b}$$"} />);

    expect(container.querySelector("math mfrac")).not.toBeNull();
  });

  it("\\sqrt{x} 渲染为根式结构（MathML msqrt）", () => {
    const { container } = render(<MarkdownContent content={"$$\\sqrt{x}$$"} />);

    expect(container.querySelector("math msqrt")).not.toBeNull();
  });

  it("aligned 多行公式正常渲染且没有错误提示", () => {
    const { container } = render(
      <MarkdownContent content={"$$\\begin{aligned} a &= b \\\\\\\\ c &= d \\end{aligned}$$"} />
    );

    expect(container.querySelector(".math-render-error")).toBeNull();
    expect(container.querySelector("math")).not.toBeNull();
  });

  it("中文与行内公式混排正常渲染", () => {
    const { container } = render(
      <MarkdownContent content={"质量 $m$ 与能量 $E=mc^2$ 的关系如下。"} />
    );

    expect(container.querySelector(".math-render-error")).toBeNull();
    expect(container.querySelector("math")).not.toBeNull();
  });

  it("非法 LaTeX 显示可见错误状态，原始公式保留，其余内容不受影响", () => {
    const { container, getByText } = render(
      <MarkdownContent content={"# 标题\n\n$$\\frac{a}{$$\n\n后面的段落 **正常** 渲染。"} />
    );

    expect(getByText("公式渲染失败，请核对原文")).toBeTruthy();
    const source = container.querySelector("span.math-render-error-source");
    expect(source?.textContent).toContain("\\frac");

    expect(container.querySelector("h1")?.textContent).toBe("标题");
    expect(container.querySelector("strong")?.textContent).toBe("正常");
    expect(container.textContent).toContain("后面的段落");
  });
});

describe("代码块与行内代码的 DOM 合法性", () => {
  it("跨行行内代码不会渲染成 div 塞进 p", () => {
    const { container } = render(
      <MarkdownContent content={"前 `code\nmore` 后"} />
    );
    const paragraph = container.querySelector("p");
    expect(paragraph).not.toBeNull();
    // <p> 里如果出现 div 就是非法嵌套
    expect(paragraph!.querySelector("div")).toBeNull();
    expect(paragraph!.querySelector("code")?.textContent).toContain("code");
  });

  it("真正的代码块仍然渲染为代码块组件", () => {
    const { container } = render(
      <MarkdownContent content={"```json\n{\"a\":1}\n```"} />
    );
    expect(container.querySelector(".markdown-code-block")).not.toBeNull();
  });

  it("无语言标记的代码块同样走代码块组件", () => {
    const { container } = render(
      <MarkdownContent content={"```\nplain code\n```"} />
    );
    expect(container.querySelector(".markdown-code-block")).not.toBeNull();
  });

  it("普通行内代码保持行内", () => {
    const { container } = render(<MarkdownContent content={"前 `code` 后"} />);
    expect(container.querySelector("p code")).not.toBeNull();
    expect(container.querySelector(".markdown-code-block")).toBeNull();
  });
});
