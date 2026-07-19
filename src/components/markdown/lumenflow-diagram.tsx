"use client";

import { ArrowLeft, ArrowRight } from "lucide-react";

import { parseLumenFlow } from "@/lib/lumenflow";

export function LumenFlowDiagram({ code, isStreaming = false }: { code: string; isStreaming?: boolean }) {
  const parsed = parseLumenFlow(code);

  if (!parsed.ok) {
    return (
      <div data-render-state="failed" className="my-4 rounded-[var(--radius-lg)] bg-[var(--color-surface)] p-3">
        <p className="mb-2 text-xs font-medium text-[var(--color-warning)]">LumenFlow 格式无效：{parsed.error}</p>
        <pre className="overflow-x-auto text-xs leading-6 text-[var(--color-text-secondary)]"><code>{code}</code></pre>
      </div>
    );
  }

  const { diagram } = parsed;

  return (
    <figure data-render-state={isStreaming ? "pending" : "ready"} className="my-5 overflow-x-auto rounded-[var(--radius-xl)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)]">
      {diagram.title && <figcaption className="mb-3 text-sm font-semibold text-[var(--color-text-primary)]">{diagram.title}</figcaption>}
      <div className="flex min-w-max items-center gap-2">
        {diagram.nodes.map((node, index) => (
          <div key={node.id} className="flex items-center gap-2">
            <div
              className={
                node.tone === "primary"
                  ? "min-w-36 rounded-[var(--radius-lg)] bg-[var(--color-brand)] px-4 py-3 text-center text-sm font-semibold text-white shadow-[var(--shadow-panel)]"
                  : "min-w-36 rounded-[var(--radius-lg)] bg-[var(--color-panel)] px-4 py-3 text-center text-sm font-semibold text-[var(--color-text-primary)] shadow-[var(--shadow-panel)]"
              }
            >
              {node.label}
            </div>
            {index < diagram.nodes.length - 1 && (
              <ArrowRight
                aria-hidden="true"
                className="h-5 w-5 text-[var(--color-brand)]"
              />
            )}
          </div>
        ))}
      </div>
      {diagram.returnFlow && (
        <div className="mt-4 flex min-w-max items-center gap-2 text-xs text-[var(--color-text-secondary)]">
          <ArrowLeft aria-hidden="true" className="h-4 w-4 text-[var(--color-text-secondary)]" />
          <span className="font-semibold text-[var(--color-text-primary)]">{diagram.returnFlow.label}</span>
          <span>{diagram.returnFlow.text}</span>
        </div>
      )}
    </figure>
  );
}
