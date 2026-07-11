"use client";

import type { ComponentProps } from "react";
import React from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { MermaidBlock } from "@/components/chat/mermaid-block";
import { cn } from "@/lib/utils";

interface DocsMarkdownProps {
  content: string;
  className?: string;
}

function makeHeadingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w\-一-龥]/g, "")
    .slice(0, 64);
}

interface HeadingProps {
  level: number;
  children?: React.ReactNode;
  className?: string;
}

function Heading({ level, children, className }: HeadingProps) {
  const text = typeof children === "string" ? children : "";
  const id = makeHeadingId(text);
  const sharedClassName = cn("scroll-mt-24", className);
  switch (level) {
    case 1:
      return <h1 id={id} className={sharedClassName}>{children}</h1>;
    case 2:
      return <h2 id={id} className={sharedClassName}>{children}</h2>;
    case 3:
      return <h3 id={id} className={sharedClassName}>{children}</h3>;
    case 4:
      return <h4 id={id} className={sharedClassName}>{children}</h4>;
    case 5:
      return <h5 id={id} className={sharedClassName}>{children}</h5>;
    case 6:
      return <h6 id={id} className={sharedClassName}>{children}</h6>;
    default:
      return <div className={sharedClassName}>{children}</div>;
  }
}

export function DocsMarkdown({ content, className }: DocsMarkdownProps) {
  return (
    <div
      className={cn(
        "workbench-readable markdown-body break-words [&>:first-child]:mt-0",
        className
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          rehypeRaw,
          rehypeSanitize,
          [rehypeKatex, { strict: "ignore", throwOnError: false, output: "html" }],
          rehypeHighlight,
        ]}
        components={{
          h1(props) {
            return <Heading level={1} {...props} />;
          },
          h2(props) {
            return <Heading level={2} {...props} />;
          },
          h3(props) {
            return <Heading level={3} {...props} />;
          },
          h4(props) {
            return <Heading level={4} {...props} />;
          },
          h5(props) {
            return <Heading level={5} {...props} />;
          },
          h6(props) {
            return <Heading level={6} {...props} />;
          },
          code(props) {
            const { className: codeClassName, children, ...rest } = props;
            const match = /language-(\w+)/.exec(codeClassName || "");
            const code = String(children).replace(/\n$/, "");
            if (match?.[1] === "mermaid") {
              return <MermaidBlock code={code} isStreaming={false} />;
            }
            return (
              <code className={codeClassName} {...rest}>
                {children}
              </code>
            );
          },
          img({ src = "", alt = "", ...props }: ComponentProps<"img">) {
            return (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                {...props}
                src={typeof src === "string" ? src : undefined}
                alt={alt}
                loading="lazy"
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
