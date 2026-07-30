"use client";

import { useId, type ComponentProps } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { Root, RootContent } from "hast";
import { MermaidBlock } from "@/components/chat/mermaid-block";
import { LumenFlowDiagram } from "@/components/markdown/lumenflow-diagram";
import { cn } from "@/lib/utils";

interface MarkdownContentProps {
  content: string;
  isStreaming?: boolean;
  resolveImageUrl?: (src: string) => string;
  imageLoading?: "eager" | "lazy";
  className?: string;
}

// remark-gfm 生成的脚注 id/href 已带 user-content- 前缀；defaultSchema 的
// clobber 会再叠加一次前缀（user-content-user-content-fnref-*），导致
// #user-content-fnref-* 永远匹配不到元素、引用跳转完全失效。关闭 clobber
// 让脚注 id 与 href 保持一致。
const sanitizeSchema = { ...defaultSchema, clobber: [] };

// 脚注 id（fn / fnref / footnote-label）在同一页面的多条消息间会重复，
// 锚点跳转会落到别条消息的脚注上。给每个 MarkdownContent 实例的脚注
// id/href 加上实例级前缀，保证跳转落在本消息内。
function rehypeScopeFootnoteIds(prefix: string) {
  return () => (tree: Root) => {
    const walk = (node: Root | RootContent) => {
      if (node.type === "element") {
        const { id, href } = node.properties ?? {};
        if (typeof id === "string" && /^user-content-f(n|ootnote)/.test(id)) {
          node.properties.id = prefix + id;
        }
        if (typeof href === "string" && href.startsWith("#user-content-f")) {
          node.properties.href = `#${prefix}${href.slice(1)}`;
        }
      }
      if ("children" in node) {
        for (const child of node.children) walk(child);
      }
    };
    walk(tree);
  };
}

export function MarkdownContent({
  content,
  isStreaming = false,
  resolveImageUrl = (src) => src,
  imageLoading = "lazy",
  className,
}: MarkdownContentProps) {
  // useId 含 ":"，去掉后作为实例级脚注前缀
  const footnotePrefix = `fn${useId().replace(/:/g, "")}-`;
  return (
    <div
      className={cn(
        "workbench-readable markdown-body break-words",
        className
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          rehypeRaw,
          [rehypeSanitize, sanitizeSchema],
          rehypeScopeFootnoteIds(footnotePrefix),
          // KaTeX 走宽松模式:遇到中英混排等 strict 警告时只在控制台 warn,
          // 不抛错、不影响 markdown 渲染,让前端始终拿到可读内容。
          [rehypeKatex, { strict: "ignore", throwOnError: false, output: "html" }],
          rehypeHighlight,
        ]}
        components={{
          code(props) {
            const { className: codeClassName, children, ...rest } = props;
            const match = /language-(\w+)/.exec(codeClassName || "");
            const code = String(children).replace(/\n$/, "");
          if (match?.[1] === "mermaid") {
            return <MermaidBlock code={code} isStreaming={isStreaming} />;
          }
          if (match?.[1] === "lumenflow") {
            return <LumenFlowDiagram code={code} isStreaming={isStreaming} />;
          }
            return (
              <code className={codeClassName} {...rest}>
                {children}
              </code>
            );
          },
          img({ src = "", alt = "", ...props }: ComponentProps<"img">) {
            const resolvedSrc =
              typeof src === "string" ? resolveImageUrl(src) : src;
            return (
              // Markdown content can reference authenticated conversion assets.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                {...props}
                src={resolvedSrc}
                alt={alt}
                loading={imageLoading}
              />
            );
          },
          table(props: ComponentProps<"table">) {
            return (
              <div className="overflow-x-auto my-3">
                <table {...props} />
              </div>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
