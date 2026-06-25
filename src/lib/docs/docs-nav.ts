export interface DocSection {
  title: string;
  items: DocNavItem[];
}

export interface DocNavItem {
  slug: string;
  title: string;
  filePath: string;
}

export const DOCS_NAV: DocSection[] = [
  {
    title: "开始",
    items: [
      { slug: "getting-started", title: "快速开始", filePath: "getting-started.md" },
      { slug: "overview", title: "产品概览", filePath: "overview.md" },
      { slug: "deployment", title: "部署", filePath: "deployment.md" },
      { slug: "faq", title: "常见问题", filePath: "faq.md" },
    ],
  },
  {
    title: "架构",
    items: [
      { slug: "architecture/overview", title: "架构总览", filePath: "architecture/overview.md" },
      { slug: "architecture/data-model", title: "数据模型", filePath: "architecture/data-model.md" },
      { slug: "architecture/task-router", title: "任务路由", filePath: "architecture/task-router.md" },
      { slug: "architecture/policy-engine", title: "Policy Engine", filePath: "architecture/policy-engine.md" },
      { slug: "architecture/cache", title: "缓存架构", filePath: "architecture/cache.md" },
    ],
  },
  {
    title: "指南",
    items: [
      { slug: "guides/projects", title: "项目管理", filePath: "guides/projects.md" },
      { slug: "guides/files-and-rag", title: "资料与 RAG", filePath: "guides/files-and-rag.md" },
      { slug: "guides/artifacts", title: "成果与导出", filePath: "guides/artifacts.md" },
      { slug: "guides/agent-mode", title: "Agent 模式", filePath: "guides/agent-mode.md" },
      { slug: "guides/skills-and-tools", title: "Skills 与 Tools", filePath: "guides/skills-and-tools.md" },
    ],
  },
  {
    title: "参考",
    items: [
      { slug: "reference/api", title: "API 参考", filePath: "reference/api.md" },
      { slug: "reference/configuration", title: "配置", filePath: "reference/configuration.md" },
      { slug: "reference/error-codes", title: "错误码", filePath: "reference/error-codes.md" },
    ],
  },
];

export function flattenNav(): DocNavItem[] {
  return DOCS_NAV.flatMap((section) => section.items);
}

export function findDocBySlug(slug: string[]): DocNavItem | undefined {
  const joined = slug.join("/");
  return flattenNav().find((item) => item.slug === joined);
}

export function findDocByFilePath(filePath: string): DocNavItem | undefined {
  return flattenNav().find((item) => item.filePath === filePath);
}

export interface DocNeighbors {
  prev: DocNavItem | null;
  next: DocNavItem | null;
}

export function getDocNeighbors(slug: string[]): DocNeighbors {
  const items = flattenNav();
  const joined = slug.join("/");
  const index = items.findIndex((item) => item.slug === joined);
  if (index === -1) return { prev: null, next: null };
  return {
    prev: items[index - 1] ?? null,
    next: items[index + 1] ?? null,
  };
}

export function extractTitle(content: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() ?? "文档";
}

export interface DocHeading {
  id: string;
  text: string;
  level: number;
}

export function extractHeadings(content: string): DocHeading[] {
  const headings: DocHeading[] = [];
  const seen = new Set<string>();
  const regex = /^(#{2,3})\s+(.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const level = match[1].length;
    const text = match[2].trim();
    let id = text
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^\w\-一-龥]/g, "")
      .slice(0, 64);
    if (!id) id = `heading-${headings.length}`;
    let uniqueId = id;
    let suffix = 1;
    while (seen.has(uniqueId)) {
      uniqueId = `${id}-${suffix}`;
      suffix++;
    }
    seen.add(uniqueId);
    headings.push({ id: uniqueId, text, level });
  }
  return headings;
}

function splitPath(url: string): { dir: string; base: string } {
  const lastSlash = url.lastIndexOf("/");
  if (lastSlash === -1) {
    return { dir: ".", base: url };
  }
  return { dir: url.slice(0, lastSlash), base: url.slice(lastSlash + 1) };
}

export function rewriteDocLinks(content: string): string {
  return content.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (match, linkText: string, rawUrl: string) => {
      const hashIndex = rawUrl.indexOf("#");
      const url = hashIndex === -1 ? rawUrl : rawUrl.slice(0, hashIndex);
      const hash = hashIndex === -1 ? "" : rawUrl.slice(hashIndex + 1);
      if (!url || url.startsWith("http") || url.startsWith("mailto") || url.startsWith("/")) {
        return match;
      }
      if (!url.endsWith(".md")) {
        return match;
      }
      const { dir, base } = splitPath(url);
      const baseName = base.replace(/\.md$/, "");
      const normalizedDir = dir === "." ? "" : dir.replace(/^\.\//, "");
      const slug = normalizedDir ? `${normalizedDir}/${baseName}` : baseName;
      const newUrl = `/docs/${slug}${hash ? `#${hash}` : ""}`;
      return `[${linkText}](${newUrl})`;
    }
  );
}
