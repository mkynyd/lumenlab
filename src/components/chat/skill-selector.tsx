"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Brain,
  ChatBubbleQuestion,
  CodeBrackets,
  EditPencil,
  GraduationCap,
  MagicWand,
  OpenBook,
  TaskList,
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

/** 硬编码 fallback（API 不可用时使用） */
export const BUILTIN_SKILL_OPTIONS = [
  { value: "auto", label: "自动 Skill" },
  { value: "paper-reader", label: "论文阅读" },
  { value: "paper-writer", label: "论文写作" },
  { value: "exam-extract", label: "考点分析" },
  { value: "exam-coach", label: "复习教练" },
  { value: "code-reader", label: "代码阅读" },
  { value: "socratic-tutor", label: "苏格拉底导师" },
  { value: "off", label: "关闭 Skill" },
] as const;

export type SkillSelectorValue = string;

interface SkillOption {
  value: string;
  label: string;
}

interface SkillSelectorProps {
  value: SkillSelectorValue;
  onChange: (value: SkillSelectorValue) => void;
  disabled?: boolean;
  compact?: boolean;
}

/** 从 /api/skills/catalog 加载动态 skill 列表 */
function useSkillCatalog(): { options: SkillOption[]; loading: boolean } {
  const [options, setOptions] = useState<SkillOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/skills/catalog")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data?.categories) return;
        const items: SkillOption[] = [];
        for (const cat of data.categories) {
          for (const skill of cat.skills) {
            items.push({
              value: skill.name,
              label: skill.displayName || skill.name,
            });
          }
        }
        setOptions(items);
      })
      .catch(() => {
        // API 不可用时静默失败，使用 fallback
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  return { options, loading };
}

const SKILL_ICONS: Record<string, typeof Brain> = {
  auto: MagicWand,
  "paper-reader": OpenBook,
  "paper-writer": EditPencil,
  "exam-extract": TaskList,
  "exam-coach": GraduationCap,
  "code-reader": CodeBrackets,
  "socratic-tutor": ChatBubbleQuestion,
  off: Xmark,
};

function getSkillIcon(value: string) {
  return SKILL_ICONS[value] ?? Brain;
}

export function SkillSelector({
  value,
  onChange,
  disabled,
  compact = true,
}: SkillSelectorProps) {
  const { options: dynamicOptions, loading: _loading } = useSkillCatalog();

  // 合并动态选项 + 固定选项（auto / off）
  const allOptions = useMemo(() => {
    const merged: SkillOption[] = [
      { value: "auto", label: "自动 Skill" },
    ];
    // 优先使用 API 返回的动态选项
    if (dynamicOptions.length > 0) {
      for (const opt of dynamicOptions) {
        merged.push(opt);
      }
    } else {
      // Fallback 到硬编码
      for (const opt of BUILTIN_SKILL_OPTIONS) {
        if (opt.value !== "auto" && opt.value !== "off") {
          merged.push({ value: opt.value, label: opt.label });
        }
      }
    }
    merged.push({ value: "off", label: "关闭 Skill" });
    return merged;
  }, [dynamicOptions]);

  const selected = allOptions.find((option) => option.value === value);
  const isOff = value === "off";
  const TriggerIcon = isOff ? Xmark : getSkillIcon(value);

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
          {allOptions.map((option) => {
            const Icon = getSkillIcon(option.value);
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
