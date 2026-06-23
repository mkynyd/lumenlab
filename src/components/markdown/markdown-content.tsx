"use client";

import type { ComponentProps } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { MermaidBlock } from "@/components/chat/mermaid-block";
import { cn } from "@/lib/utils";

interface MarkdownContentProps {
  content: string;
  isStreaming?: boolean;
  resolveImageUrl?: (src: string) => string;
  imageLoading?: "eager" | "lazy";
  className?: string;
}

export function MarkdownContent({
  content,
  isStreaming = false,
  resolveImageUrl = (src) => src,
  imageLoading = "lazy",
  className,
}: MarkdownContentProps) {
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
          rehypeSanitize,
          // KaTeX 走宽松模式:遇到中英混排等 strict 警告时只在控制台 warn,
          // 不抛错、不影响 markdown 渲染,让前端始终拿到可读内容。
          [rehypeKatex, { strict: false, throwOnError: false, output: "html" }],
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
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
