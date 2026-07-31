import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/learning/empty-state";
import { FreshnessBadge } from "@/components/learning/freshness-badge";
import { cn } from "@/lib/utils";
import type { KnowledgeMapDto } from "@/lib/hooks/use-learning-api";

export interface KnowledgeMapViewProps {
  map: KnowledgeMapDto | null;
  isGenerating?: boolean;
  onGenerate?: () => void;
  generateDisabled?: boolean;
  className?: string;
}

const KNOWLEDGE_POINT_KIND_LABELS: Readonly<Record<string, string>> = {
  concept: "概念",
  skill: "技能",
  procedure: "方法",
  fact: "事实",
};

/**
 * Read-only knowledge-map list. The empty state offers map generation when an
 * `onGenerate` handler is provided; rows are separated by hairlines only and
 * unsupported points degrade to tertiary text.
 */
export function KnowledgeMapView({
  map,
  isGenerating = false,
  onGenerate,
  generateDisabled = false,
  className,
}: KnowledgeMapViewProps) {
  if (!map) {
    return (
      <EmptyState
        className={className}
        title="还没有知识点地图"
        description="确认学习范围后，生成知识点地图，开始诊断与练习。"
        action={
          onGenerate ? (
            <Button
              type="button"
              onClick={onGenerate}
              disabled={isGenerating || generateDisabled}
            >
              {isGenerating ? "生成中…" : "生成知识点地图"}
            </Button>
          ) : undefined
        }
      />
    );
  }

  const points = [...map.points].sort((a, b) => a.orderIndex - b.orderIndex);

  return (
    <section className={cn("w-full", className)}>
      <p className="text-xs text-[var(--color-text-secondary)]">
        共 {points.length} 个知识点
      </p>
      <ul className="mt-3 divide-y divide-[var(--color-border-light)]">
        {points.map((point) => {
          const unsupported = point.freshness === "unsupported";
          return (
            <li
              key={point.id}
              className="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-2.5"
            >
              <span
                className={cn(
                  "text-sm",
                  unsupported
                    ? "text-[var(--color-text-tertiary)]"
                    : "text-[var(--color-text-primary)]"
                )}
              >
                {point.name}
              </span>
              {KNOWLEDGE_POINT_KIND_LABELS[point.kind] ? (
                <span className="text-xs text-[var(--color-text-tertiary)]">
                  {KNOWLEDGE_POINT_KIND_LABELS[point.kind]}
                </span>
              ) : null}
              <FreshnessBadge freshness={point.freshness} />
              {point.sourceAnchors.length > 0 && (
                <span className="text-xs text-[var(--color-text-tertiary)]">
                  {point.sourceAnchors.length} 个来源
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
