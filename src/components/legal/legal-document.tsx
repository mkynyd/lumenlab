"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** 法律文档（用户协议/隐私政策）的只读 Markdown 渲染，复用 .markdown-body 排版 */
export function LegalDocument({ content }: { content: string }) {
  return (
    <div className="markdown-body break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}
