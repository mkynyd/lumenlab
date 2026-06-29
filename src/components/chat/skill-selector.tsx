"use client";

import { Bot, Wand2, X } from "lucide-react";
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

const SKILL_ICONS: Record<string, React.ReactNode> = {
  "paper-reader": "📄",
  "paper-writer": "✍️",
  "exam-extract": "🎯",
  "exam-coach": "🎓",
  "code-reader": "💻",
  "socratic-tutor": "❓",
};

export function SkillSelector({
  value,
  onChange,
  disabled,
  compact = true,
}: SkillSelectorProps) {
  const selected = BUILTIN_SKILL_OPTIONS.find((option) => option.value === value);
  const isOff = value === "off";

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
          {isOff ? <X size={17} strokeWidth={2} /> : <Bot size={17} strokeWidth={2} />}
          {!compact && selected && (
            <span className="ml-1.5 text-xs">{selected.label}</span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="workbench-border-glow min-w-40">
        <DropdownMenuGroup>
          {BUILTIN_SKILL_OPTIONS.map((option) => (
            <DropdownMenuItem
              key={option.value}
              onSelect={() => onChange(option.value)}
              className={cn(
                "justify-start gap-2 text-xs",
                option.value === value && "bg-accent text-accent-foreground"
              )}
            >
              <span className="inline-flex w-4 justify-center">
                {option.value === "auto" && <Wand2 size={14} />}
                {option.value === "off" && <X size={14} />}
                {SKILL_ICONS[option.value]}
              </span>
              {option.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
