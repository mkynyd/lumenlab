// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DOCS_NAV, findDocBySlug, rewriteDocLinks } from "./docs-nav";

describe("documentation links", () => {
  it("resolves sibling links within architecture pages", () => {
    expect(rewriteDocLinks("[路由](./task-router.md#路由规则)", "architecture/overview.md"))
      .toBe("[路由](/docs/architecture/task-router#路由规则)");
    expect(rewriteDocLinks("[架构](./overview.md)", "architecture/cache.md"))
      .toBe("[架构](/docs/architecture/overview)");
  });

  it("resolves parent links and the documentation home page", () => {
    expect(rewriteDocLinks("[上手](../getting-started.md)", "guides/projects.md"))
      .toBe("[上手](/docs/getting-started)");
    expect(rewriteDocLinks("[首页](../README.md#文档导航)", "architecture/overview.md"))
      .toBe("[首页](/docs#文档导航)");
    expect(rewriteDocLinks("[指南](./user-guide.md)"))
      .toBe("[指南](/docs/user-guide)");
    expect(findDocBySlug(["user-guide"])?.filePath).toBe("user-guide.md");
  });

  it("preserves external links, anchors, assets and unknown documents", () => {
    const content = "[外部](https://example.com/readme.md) [邮箱](mailto:dev@example.com) "
      + "[定位](#当前页面) [绝对地址](/docs/overview) [资源](chart.svg) [未知](missing.md)";
    expect(rewriteDocLinks(content, "guides/projects.md")).toBe(content);
  });

  it("resolves every relative Markdown link in the published documentation", () => {
    const files = ["README.md", ...DOCS_NAV.flatMap(section => section.items.map(item => item.filePath))];
    for (const file of files) {
      const content = readFileSync(path.join(process.cwd(), "docs/LumenLabDocs", file), "utf8");
      const rewritten = rewriteDocLinks(content, file);
      for (const [, target] of rewritten.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
        expect(target, `${file}: unresolved ${target}`).not.toMatch(/^(?:\.\.?\/)?[^:#?]+\.md(?:#.*)?$/);
        if (target.startsWith("/docs/")) {
          const slug = target.slice("/docs/".length).split("#")[0].split("/");
          expect(findDocBySlug(slug), `${file}: unknown ${target}`).toBeDefined();
        }
      }
    }
  });
});
