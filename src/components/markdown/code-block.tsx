"use client";

import { useState } from "react";
import { Check, Code2, Copy } from "lucide-react";

interface CodeBlockProps {
  code: string;
  language?: string;
}

const LANGUAGE_LABELS: Record<string, string> = {
  js: "JavaScript",
  jsx: "JavaScript",
  ts: "TypeScript",
  tsx: "TypeScript",
  py: "Python",
  sh: "Shell",
  bash: "Shell",
};

export function CodeBlock({ code, language }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  async function copyCode() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_200);
  }

  return (
    <div className="markdown-code-block">
      <div className="markdown-code-header">
        <span className="inline-flex items-center gap-1.5">
          <Code2 size={14} aria-hidden />
          <span>{language ? LANGUAGE_LABELS[language] ?? language : "代码"}</span>
        </span>
        <button
          type="button"
          className="markdown-code-copy"
          onClick={copyCode}
          aria-label={copied ? "已复制代码" : "复制代码"}
        >
          {copied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
          <span>{copied ? "已复制" : "复制"}</span>
        </button>
      </div>
      <pre><code className={language ? `language-${language}` : undefined}>{code}</code></pre>
    </div>
  );
}
