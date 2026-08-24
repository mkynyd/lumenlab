import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { Root } from "mdast";

export function parseMarkdown(content: string): Root {
  return unified().use(remarkParse).use(remarkGfm).use(remarkMath).parse(content) as Root;
}

export function markdownNodeText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const value = node as { value?: unknown; children?: unknown[] };
  if (typeof value.value === "string") return value.value;
  return (value.children || []).map(markdownNodeText).join("");
}
