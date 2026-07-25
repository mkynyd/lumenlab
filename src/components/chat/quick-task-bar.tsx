"use client";

import { MoreHoriz } from "iconoir-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  getDefaultQuickActions,
  type ProjectType,
} from "@/lib/quick-actions";

export type { ProjectType } from "@/lib/quick-actions";

export interface QuickTaskAction {
  id?: string;
  title: string;
  prompt: string;
  isSystem?: boolean;
  sortOrder?: number;
  materialScope?: "project-corpus" | "none";
}

export interface QuickTaskSendInput {
  label: string;
  prompt: string;
  quickActionId?: string;
  materialScope?: "project-corpus" | "none";
}

interface QuickTaskBarProps {
  projectType: ProjectType;
  actions?: QuickTaskAction[];
  onSend: (input: QuickTaskSendInput) => void;
  disabled?: boolean;
  className?: string;
}

function sortActions(actions: QuickTaskAction[]) {
  return [...actions].sort(
    (a, b) =>
      Number(Boolean(b.isSystem)) - Number(Boolean(a.isSystem)) ||
      (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
      a.title.localeCompare(b.title, "zh-Hans-CN")
  );
}

function resolveQuickActions(projectType: ProjectType, actions?: QuickTaskAction[]) {
  const defaults = getDefaultQuickActions(projectType);
  if (!actions?.length) return defaults;

  const suppliedByTitle = new Map(actions.map((action) => [action.title, action]));
  const defaultTitles = new Set(defaults.map((action) => action.title));
  const systemActions = defaults.map((action) => ({
    ...action,
    ...suppliedByTitle.get(action.title),
    isSystem: true,
  }));
  const personalizedActions = actions
    .filter((action) => !defaultTitles.has(action.title))
    .map((action) => ({ ...action, isSystem: false }));

  return sortActions([...systemActions, ...personalizedActions]);
}

function toSendInput(action: QuickTaskAction): QuickTaskSendInput {
  return {
    label: `快捷任务：${action.title}`,
    prompt: action.prompt,
    quickActionId: action.id,
    materialScope: action.materialScope ?? "project-corpus",
  };
}

function ActionButton({
  action,
  onSend,
  disabled,
}: {
  action: QuickTaskAction;
  onSend: (input: QuickTaskSendInput) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onSend(toSendInput(action))}
      disabled={disabled}
      className={cn(
        "h-8 shrink-0 rounded-full px-3 text-xs",
        "bg-[var(--color-project-control)]",
        "text-[var(--color-text-secondary)]",
        "hover:bg-[var(--color-project-surface-hover)] hover:text-[var(--color-text-primary)]",
        "focus-visible:bg-[var(--color-project-surface-hover)] focus-visible:text-[var(--color-text-primary)]",
        "transition-[background-color,color] duration-150",
        "disabled:opacity-40 disabled:cursor-not-allowed"
      )}
    >
      {action.title}
    </button>
  );
}

/**
 * 输入区上方的建议 chips（ChatGPT suggestion 样式）。
 *  - 统一一套布局：常用任务以胶囊横排展示，超出与自定义任务收进「更多」
 *  - 不再占用项目顶栏；移动端同样横滑浏览
 */
export function QuickTaskBar({
  projectType,
  actions,
  onSend,
  disabled,
  className,
}: QuickTaskBarProps) {
  const resolvedActions: QuickTaskAction[] = resolveQuickActions(projectType, actions);
  const systemActions = resolvedActions.filter((action) => action.isSystem !== false);
  const customActions = resolvedActions.filter((action) => action.isSystem === false);
  const previewActions = systemActions.slice(0, 3);
  const overflowActions = systemActions.slice(3);
  const hasMoreActions = overflowActions.length > 0 || customActions.length > 0;

  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className
      )}
    >
      {previewActions.map((action) => (
        <ActionButton
          key={action.id || action.title}
          action={action}
          onSend={onSend}
          disabled={disabled}
        />
      ))}
      {hasMoreActions && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={disabled}
              className={cn(
                "inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs",
                "text-[var(--color-text-tertiary)]",
                "hover:bg-[var(--color-project-surface-hover)] hover:text-[var(--color-text-primary)]",
                "focus-visible:bg-[var(--color-project-surface-hover)] focus-visible:text-[var(--color-text-primary)]",
                "data-[state=open]:bg-[var(--color-project-surface-active)]",
                "disabled:cursor-not-allowed disabled:opacity-40"
              )}
              aria-label="更多快捷任务"
            >
              <MoreHoriz width={14} height={14} strokeWidth={2} />
              更多
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            {overflowActions.map((action) => (
              <DropdownMenuItem
                key={action.id || action.title}
                disabled={disabled}
                onSelect={() => onSend(toSendInput(action))}
              >
                {action.title}
              </DropdownMenuItem>
            ))}
            {overflowActions.length > 0 && customActions.length > 0 && (
              <DropdownMenuSeparator />
            )}
            {customActions.length > 0 && (
              <>
                <DropdownMenuLabel>我的任务</DropdownMenuLabel>
                {customActions.map((action) => (
                  <DropdownMenuItem
                    key={action.id || action.title}
                    disabled={disabled}
                    onSelect={() => onSend(toSendInput(action))}
                  >
                    {action.title}
                  </DropdownMenuItem>
                ))}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
