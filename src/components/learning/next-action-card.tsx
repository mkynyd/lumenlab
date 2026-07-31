import Link from "next/link";
import type { ComponentType } from "react";
import {
  ClipboardCheck,
  FastArrowRight,
  Map,
  Play,
  Refresh,
} from "iconoir-react";
import { cn } from "@/lib/utils";
import type {
  LearningTodayGoalDto,
  TodayNextActionDto,
  TodayNextActionType,
} from "@/lib/hooks/use-learning-api";
import { Button } from "@/components/ui/button";

export interface NextActionCardProps {
  entry: LearningTodayGoalDto;
  className?: string;
}

interface IconProps {
  width?: number;
  height?: number;
  strokeWidth?: number;
  "aria-hidden"?: boolean | "true" | "false";
}

const TYPE_PRESENTATION: Record<
  TodayNextActionType,
  { label: string; cta: string; Icon: ComponentType<IconProps> }
> = {
  confirm_scope: { label: "确认学习范围", cta: "去确认", Icon: ClipboardCheck },
  generate_map: { label: "生成知识地图", cta: "去生成", Icon: Map },
  start_diagnostic: { label: "开始诊断练习", cta: "开始诊断", Icon: Play },
  review: { label: "到期复习", cta: "去复习", Icon: Refresh },
  continue_learning: {
    label: "继续学习",
    cta: "进入学习",
    Icon: FastArrowRight,
  },
};

const zhDate = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

/**
 * One-sentence reason derived client-side from the action type (and the
 * optional dueCount / nextReviewAt hints the server attaches).
 */
export function describeNextActionReason(action: TodayNextActionDto): string {
  switch (action.type) {
    case "review":
      return action.dueCount != null
        ? `有 ${action.dueCount} 个知识点到期复习，先巩固已学内容`
        : "有知识点到期复习，先巩固已学内容";
    case "start_diagnostic":
      return "还没有做过诊断，先完成一轮诊断练习";
    case "confirm_scope":
      return "先确认学习范围，才能生成地图和练习";
    case "generate_map":
      return "范围已确认，下一步生成知识点地图";
    case "continue_learning":
      return action.nextReviewAt
        ? `保持节奏，下次复习在 ${zhDate.format(new Date(action.nextReviewAt))}`
        : "保持节奏，继续学习";
  }
}

/**
 * The single next-step card on the Today view. Flat surface, no borders,
 * no hover lift — hierarchy comes from spacing and text weight only.
 */
export function NextActionCard({ entry, className }: NextActionCardProps) {
  const { nextAction } = entry;
  const { label, cta, Icon } = TYPE_PRESENTATION[nextAction.type];

  return (
    <div
      className={cn(
        "rounded-xl bg-[var(--color-surface-hover)] p-4",
        className
      )}
    >
      <div className="flex items-center gap-1.5 text-sm font-medium text-[var(--color-text-primary)]">
        <Icon aria-hidden="true" width={16} height={16} strokeWidth={1.8} />
        {label}
      </div>
      <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
        {describeNextActionReason(nextAction)}
      </p>
      <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">
        {entry.project.name} · {entry.goal.title}
      </p>
      <Button asChild className="mt-3">
        <Link href={nextAction.href}>{cta}</Link>
      </Button>
    </div>
  );
}
