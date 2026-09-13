"use client";

import { useState } from "react";

/**
 * 长文本截断 + 受控展开：默认 line-clamp-3，点「展开」显示全文。
 * 展开状态由组件内部托管，随 text 变化重置。
 */
export function ResearchExpandableText({
  text,
  className,
  expandLabel = "展开",
  collapseLabel = "收起",
}: {
  text: string;
  className?: string;
  expandLabel?: string;
  collapseLabel?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [lastText, setLastText] = useState(text);
  if (lastText !== text) {
    setLastText(text);
    setExpanded(false);
  }
  return (
    <span className="block min-w-0">
      <span className={`block ${expanded ? "" : "line-clamp-3"} ${className ?? ""}`}>{text}</span>
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={expanded}
        className="mt-0.5 text-[11px] text-[var(--color-accent)] hover:underline"
      >
        {expanded ? collapseLabel : expandLabel}
      </button>
    </span>
  );
}
