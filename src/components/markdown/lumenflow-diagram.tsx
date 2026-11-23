"use client";

import { ArrowLeft, ArrowRight } from "lucide-react";

import { parseLumenFlow, type LumenFlowTone } from "@/lib/lumenflow";

interface SalvagedFlow {
  nodes: Array<{ id: string; label: string; tone: LumenFlowTone }>;
  returnFlow?: { label: string; text: string };
}

export function LumenFlowDiagram({ code, isStreaming = false }: { code: string; isStreaming?: boolean }) {
  const parsed = parseLumenFlow(code);

  if (!parsed.ok) {
    const salvaged = /节点文字不能为空|returnFlow 需要长度受限/.test(parsed.error)
      ? salvageFlow(code)
      : null;
    if (salvaged) {
      return (
        <figure data-render-state={isStreaming ? "pending" : "ready"} className="my-5 overflow-x-auto rounded-[var(--radius-xl)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)]">
          <p className="mb-3 text-xs text-[var(--color-text-tertiary)]">
            图表文字超出长度限制，以下按节点顺序展示；正文保留完整说明。
          </p>
          <div className="flex min-w-max items-center gap-2">
            {salvaged.nodes.map((node, index) => (
              <div key={node.id} className="flex items-center gap-2">
                <div
                  title={node.label}
                  className={
                    node.tone === "primary"
                      ? "max-w-64 min-w-36 rounded-[var(--radius-lg)] bg-[var(--color-brand)] px-4 py-3 text-center text-sm font-semibold break-words whitespace-normal text-white shadow-[var(--shadow-panel)]"
                      : "max-w-64 min-w-36 rounded-[var(--radius-lg)] bg-[var(--color-panel)] px-4 py-3 text-center text-sm font-semibold break-words whitespace-normal text-[var(--color-text-primary)] shadow-[var(--shadow-panel)]"
                  }
                >
                  {node.label}
                </div>
                {index < salvaged.nodes.length - 1 && (
                  <ArrowRight aria-hidden="true" className="h-5 w-5 shrink-0 text-[var(--color-brand)]" />
                )}
              </div>
            ))}
          </div>
          {salvaged.returnFlow && (
            <div className="mt-4 flex min-w-max items-center gap-2 text-xs text-[var(--color-text-secondary)]">
              <ArrowLeft aria-hidden="true" className="h-4 w-4 text-[var(--color-text-secondary)]" />
              <span className="font-semibold text-[var(--color-text-primary)]">{salvaged.returnFlow.label}</span>
              <span>{salvaged.returnFlow.text}</span>
            </div>
          )}
        </figure>
      );
    }

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

/**
 * Keep an otherwise valid flow readable when only a label overruns the
 * grammar limit. The strict parser remains the source of truth for export.
 */
function salvageFlow(code: string): SalvagedFlow | null {
  let raw: unknown;
  try {
    raw = JSON.parse(code);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const nodes = Array.isArray(value.nodes)
    ? value.nodes.flatMap((node) => {
        if (!node || typeof node !== "object" || Array.isArray(node)) return [];
        const record = node as Record<string, unknown>;
        const id = typeof record.id === "string" ? record.id.trim() : "";
        const label = typeof record.label === "string" ? record.label.trim() : "";
        if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/.test(id) || !label) return [];
        return [{
          id,
          label,
          tone: record.tone === "primary" ? "primary" as const : "default" as const,
        }];
      })
    : [];
  if (nodes.length === 0 || nodes.length > 12) return null;

  const rawReturnFlow = value.returnFlow;
  if (!rawReturnFlow || typeof rawReturnFlow !== "object" || Array.isArray(rawReturnFlow)) {
    return { nodes };
  }
  const label = typeof (rawReturnFlow as Record<string, unknown>).label === "string"
    ? ((rawReturnFlow as Record<string, unknown>).label as string).trim()
    : "";
  const text = typeof (rawReturnFlow as Record<string, unknown>).text === "string"
    ? ((rawReturnFlow as Record<string, unknown>).text as string).trim()
    : "";
  return { nodes, ...(label && text ? { returnFlow: { label, text } } : {}) };
}
