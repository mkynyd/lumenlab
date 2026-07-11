"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
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
      onClick={() =>
        onSend({
          label: `快捷任务：${action.title}`,
          prompt: action.prompt,
          quickActionId: action.id,
          materialScope: action.materialScope ?? "project-corpus",
        })
      }
      disabled={disabled}
      className={cn(
        "rounded-xl px-3 py-2 text-xs",
        "bg-[var(--color-project-control)]",
        "text-[var(--color-text-secondary)]",
        "hover:bg-[var(--color-project-surface-hover)] hover:text-[var(--color-text-primary)]",
        "focus-visible:bg-[var(--color-project-surface-hover)] focus-visible:text-[var(--color-text-primary)]",
        "transition-[background-color,color] duration-150 whitespace-nowrap",
        "disabled:opacity-40 disabled:cursor-not-allowed"
      )}
    >
      {action.title}
    </button>
  );
}

export function QuickTaskBar({
  projectType,
  actions,
  onSend,
  disabled,
  className,
}: QuickTaskBarProps) {
  const [customOpen, setCustomOpen] = useState(false);
  const [systemExpanded, setSystemExpanded] = useState(true);
  const resolvedActions: QuickTaskAction[] = resolveQuickActions(projectType, actions);
  const systemActions = resolvedActions.filter((action) => action.isSystem !== false);
  const customActions = resolvedActions.filter((action) => action.isSystem === false);
  // Show all when expanded, show up to 6 when collapsed (more natural threshold)
  const PREVIEW_COUNT = 6;
  const showExpandButton = systemActions.length > PREVIEW_COUNT;
  const visibleSystemActions = systemExpanded || !showExpandButton ? systemActions : systemActions.slice(0, PREVIEW_COUNT);

  return (
    <div className={cn("workbench-animated-list flex flex-wrap items-center gap-1.5", className)}>
      {visibleSystemActions.map((action) => (
        <ActionButton
          key={action.id || action.title}
          action={action}
          onSend={onSend}
          disabled={disabled}
        />
      ))}
      {showExpandButton && !systemExpanded && (
        <button
          type="button"
          onClick={() => setSystemExpanded(true)}
          className={cn(
            "inline-flex items-center gap-1 rounded-xl px-3 py-2 text-xs",
            "bg-[var(--color-project-control)] text-[var(--color-text-secondary)]",
            "hover:bg-[var(--color-project-surface-hover)] hover:text-[var(--color-text-primary)]",
            "focus-visible:bg-[var(--color-project-surface-hover)]",
            "transition-[background-color,color] duration-150 whitespace-nowrap"
          )}
        >
          <ChevronRight size={12} />
          更多 ({systemActions.length - PREVIEW_COUNT})
        </button>
      )}
      {showExpandButton && systemExpanded && (
        <button
          type="button"
          onClick={() => setSystemExpanded(false)}
          className={cn(
            "inline-flex items-center gap-1 rounded-xl px-3 py-2 text-xs",
            "bg-[var(--color-project-control)] text-[var(--color-text-secondary)]",
            "hover:bg-[var(--color-project-surface-hover)] hover:text-[var(--color-text-primary)]",
            "focus-visible:bg-[var(--color-project-surface-hover)]",
            "transition-[background-color,color] duration-150 whitespace-nowrap"
          )}
        >
          <ChevronDown size={12} />
          收起
        </button>
      )}
      {customActions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setCustomOpen((current) => !current)}
            className={cn(
	              "inline-flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs",
	              "bg-[var(--color-project-control)] text-[var(--color-text-secondary)]",
	              "hover:bg-[var(--color-project-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:bg-[var(--color-project-surface-hover)] aria-expanded:bg-[var(--color-project-surface-active)] transition-colors duration-150"
            )}
            aria-expanded={customOpen}
          >
            {customOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            个性化任务 ({customActions.length})
          </button>
          {customOpen &&
            customActions.map((action) => (
              <ActionButton
                key={action.id || action.title}
                action={action}
                onSend={onSend}
                disabled={disabled}
              />
            ))}
        </div>
      )}
    </div>
  );
}
