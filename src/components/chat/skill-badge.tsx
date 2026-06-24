"use client";

import { Sparkles } from "lucide-react";
import type { SkillMetadata } from "@/lib/agent/types";
import { cn } from "@/lib/utils";

interface SkillBadgeProps {
  skill: { skillId: string; version: string };
  className?: string;
}

export function SkillBadge({ skill, className }: SkillBadgeProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-[var(--color-accent)]/12 px-2.5 py-1 text-[11px] font-medium text-[var(--color-accent)]",
        className
      )}
    >
      <Sparkles size={10} />
      <span>{skill.skillId}</span>
      <span className="font-mono text-[10px] opacity-70">{skill.version}</span>
    </div>
  );
}

export function skillMetaMatches(
  skill: SkillMetadata,
  skillId: string
): boolean {
  return skill.skillId === skillId;
}