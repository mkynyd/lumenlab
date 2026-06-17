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
}

export interface QuickTaskSendInput {
  label: string;
  prompt: string;
  quickActionId?: string;
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
        })
      }
      disabled={disabled}
      className={cn(
        "rounded-[var(--radius-md)] px-2.5 py-1 text-xs",
        "border border-[var(--color-border-light)] bg-[var(--color-panel)]",
        "text-[var(--color-text-secondary)]",
        "hover:bg-[var(--color-accent-muted)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)]",
        "transition-colors duration-150 whitespace-nowrap",
        "disabled:opacity-40 disabled:cursor-not-allowed"
      )}
      title={action.prompt}
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
  const resolvedActions: QuickTaskAction[] =
    actions && actions.length > 0
      ? sortActions(actions)
      : getDefaultQuickActions(projectType).map((action) => ({ ...action }));
  const systemActions = resolvedActions.filter((action) => action.isSystem !== false);
  const customActions = resolvedActions.filter((action) => action.isSystem === false);

  return (
    <div className={cn("workbench-animated-list flex flex-wrap items-center gap-1.5", className)}>
      {systemActions.map((action) => (
        <ActionButton
          key={action.id || action.title}
          action={action}
          onSend={onSend}
          disabled={disabled}
        />
      ))}
      {customActions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setCustomOpen((current) => !current)}
            className={cn(
              "inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-[var(--radius-md)]",
              "border border-[var(--color-border-light)] bg-[var(--color-panel)] text-[var(--color-text-secondary)]",
              "hover:bg-[var(--color-surface-hover)] transition-colors duration-150"
            )}
            aria-expanded={customOpen}
          >
            {customOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {customActions[0].title}
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
