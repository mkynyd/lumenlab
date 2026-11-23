"use client";

import { useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { UINode } from "@/lib/chat/intelligent-ui/catalog";

type SequenceProps = Extract<UINode, { type: "sequence" }>["props"];
const fill = [
  "color-mix(in oklch, var(--color-accent) 32%, var(--color-surface))",
  "color-mix(in oklch, var(--color-accent) 18%, var(--color-surface))",
  "color-mix(in oklch, var(--color-text-secondary) 26%, var(--color-surface))",
  "color-mix(in oklch, var(--color-text-secondary) 13%, var(--color-surface))",
];
const arrowClass = "size-11 shrink-0 rounded-full focus-visible:bg-primary/20 focus-visible:ring-0 sm:size-9";

export function Sequence({ id, label, frames, current, onChange }: {
  id: string;
  label: SequenceProps["label"];
  frames: SequenceProps["frames"];
  current: number;
  onChange: (index: number) => void;
}) {
  const { scale, colors } = useMemo(() => {
    const colors = new Map<string, string>();
    let scale = 0;
    for (const frame of frames) {
      scale = Math.max(scale, frame.segments.reduce((sum, segment) => sum + segment.span, 0));
      for (const segment of frame.segments) {
        if (!colors.has(segment.label)) colors.set(segment.label, fill[colors.size % fill.length]);
      }
    }
    return { scale, colors };
  }, [frames]);
  const frame = frames[current];
  if (!frame) return null;
  return (
    <div aria-labelledby={id} className="min-w-0 space-y-3">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h3 id={id} className="min-w-0 flex-1 text-sm leading-snug font-semibold [overflow-wrap:anywhere]">{label}</h3>
        <div className="flex items-center gap-0.5">
          <span role="status" aria-label={`步骤 ${current + 1}，共 ${frames.length} 步`} className="px-1.5 text-xs tabular-nums text-muted-foreground">
            {current + 1}/{frames.length}
          </span>
          <Button type="button" size="icon" variant="ghost" className={arrowClass} aria-label="上一步"
            disabled={current === 0} onClick={() => onChange(current - 1)}>
            <ChevronLeft aria-hidden="true" />
          </Button>
          <Button type="button" size="icon" variant="ghost" className={`${arrowClass} bg-primary/12 text-primary hover:bg-primary/20`} aria-label="下一步"
            disabled={current === frames.length - 1} onClick={() => onChange(current + 1)}>
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      </div>
      <div aria-hidden="true" className="flex h-12 w-full gap-px overflow-hidden rounded-lg bg-[var(--color-surface)] sm:h-16">
        {frame.segments.map(({ label, span }, index) => (
          <div key={index} style={{ width: `${span / scale * 100}%`, backgroundColor: colors.get(label) }}
            className="flex min-w-0 items-center justify-center overflow-hidden">
            {span / scale >= 0.22 && <span className="truncate px-1 text-center text-xs font-medium">{label}</span>}
          </div>
        ))}
      </div>
      {frame.note && <p className="text-sm leading-snug text-muted-foreground [overflow-wrap:anywhere]">{frame.note}</p>}
      <ul aria-label="当前分段" className="space-y-1 text-sm">
        {frame.segments.map(({ label, detail }, index) => (
          <li key={index} className="flex min-w-0 items-start gap-x-2">
            <span aria-hidden="true" style={{ backgroundColor: colors.get(label) }} className="mt-[0.4rem] size-2.5 shrink-0 rounded-full" />
            <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{label}</span>
            {detail && <span className="max-w-[50%] text-right text-muted-foreground tabular-nums [overflow-wrap:anywhere]">{detail}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
