"use client";

import {
  Brain,
  ChatBubbleQuestion,
  CodeBrackets,
  EditPencil,
  Gps,
  GraduationCap,
  MagicWand,
  OpenBook,
  Xmark,
} from "iconoir-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const BUILTIN_SKILL_OPTIONS = [
  { value: "auto", label: "自动 Skill" },
  { value: "paper-reader", label: "论文阅读" },
  { value: "paper-writer", label: "论文写作" },
  { value: "exam-extract", label: "抓考试重点" },
  { value: "exam-coach", label: "复习教练" },
  { value: "code-reader", label: "代码阅读" },
  { value: "socratic-tutor", label: "苏格拉底导师" },
  { value: "off", label: "关闭 Skill" },
] as const;

export type SkillSelectorValue = (typeof BUILTIN_SKILL_OPTIONS)[number]["value"];

interface SkillSelectorProps {
  value: SkillSelectorValue;
  onChange: (value: SkillSelectorValue) => void;
  disabled?: boolean;
  compact?: boolean;
}

const SKILL_ICONS: Record<SkillSelectorValue, typeof Brain> = {
  auto: MagicWand,
  "paper-reader": OpenBook,
  "paper-writer": EditPencil,
  "exam-extract": Gps,
  "exam-coach": GraduationCap,
  "code-reader": CodeBrackets,
  "socratic-tutor": ChatBubbleQuestion,
  off: Xmark,
};

export function SkillSelector({
  value,
  onChange,
  disabled,
  compact = true,
}: SkillSelectorProps) {
  const selected = BUILTIN_SKILL_OPTIONS.find((option) => option.value === value);
  const isOff = value === "off";
  const TriggerIcon = isOff ? Xmark : Brain;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size={compact ? "icon-sm" : "md"}
          disabled={disabled}
          aria-label="选择 Skill"
          className={cn(
            "shrink-0 rounded-md",
            isOff && "text-[var(--color-text-tertiary)]",
            value !== "auto" && !isOff && "bg-[var(--color-surface-active)] text-[var(--color-accent)]"
          )}
        >
          <TriggerIcon className="size-[17px]" strokeWidth={2} />
          {!compact && selected && (
            <span className="ml-1.5 text-xs">{selected.label}</span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="workbench-border-glow min-w-40">
        <DropdownMenuGroup>
          {BUILTIN_SKILL_OPTIONS.map((option) => {
            const Icon = SKILL_ICONS[option.value];
            const selectedOption = option.value === value;

            return (
              <DropdownMenuItem
                key={option.value}
                onSelect={() => onChange(option.value)}
                className={cn(
                  "justify-start gap-2 text-xs text-[var(--color-text-primary)]",
                  selectedOption &&
                    "bg-[var(--color-interaction-active)] text-[var(--color-text-primary)]"
                )}
              >
                <span
                  className={cn(
                    "inline-flex size-4 items-center justify-center text-[var(--color-text-secondary)]",
                    selectedOption && "text-[var(--color-accent)]"
                  )}
                >
                  <Icon className="size-4" strokeWidth={1.9} />
                </span>
                {option.label}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
