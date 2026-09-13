"use client";

import { useEffect, useRef, useState } from "react";
import { ChatInput } from "@/components/chat/chat-input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DEFAULT_CHAT_MODEL } from "@/lib/chat/model-catalog";
import type { FileAttachment } from "@/lib/chat/router";
import { useAvailableChatModels } from "@/lib/hooks/use-available-models";
import { listResearchDomainProfiles } from "@/lib/research/domain-profile";

export type ResearchBudgetProfile = "quick" | "deep" | "comprehensive";

export interface ResearchComposerOptions {
  budgetProfile: ResearchBudgetProfile;
  commanderModel: string;
  domainProfileKey?: string;
}

interface ResearchComposerProps {
  onSend: (
    question: string,
    attachments: FileAttachment[],
    options: ResearchComposerOptions,
  ) => Promise<boolean | void>;
  showDomainSelect?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
  initialBudgetProfile?: ResearchBudgetProfile;
  initialDomainProfileKey?: string;
  initialModel?: string;
  contextHint?: string;
}

const BUDGET_OPTIONS: Array<{ value: ResearchBudgetProfile; label: string }> = [
  { value: "quick", label: "Quick · 快速" },
  { value: "deep", label: "Deep · 深入" },
  { value: "comprehensive", label: "Comprehensive · 全面" },
];

/**
 * 聊天式研究输入：领域 / 强度选择 + ChatInput（附件 + 指挥模型选择）。
 * 文本与附件草稿由 ChatInput 托管；onSend 返回 false 时保留草稿。
 */
export function ResearchComposer({
  onSend,
  showDomainSelect = false,
  autoFocus = false,
  disabled = false,
  initialBudgetProfile = "deep",
  initialDomainProfileKey = "general",
  initialModel = DEFAULT_CHAT_MODEL,
  contextHint,
}: ResearchComposerProps) {
  const [budgetProfile, setBudgetProfile] = useState<ResearchBudgetProfile>(initialBudgetProfile);
  const [domainProfileKey, setDomainProfileKey] = useState(initialDomainProfileKey);
  const [commanderModel, setCommanderModel] = useState(initialModel);
  const { availableModels } = useAvailableChatModels();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const domainProfiles = listResearchDomainProfiles();

  useEffect(() => {
    if (!autoFocus) return;
    const frame = window.requestAnimationFrame(() => {
      containerRef.current?.querySelector("textarea")?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [autoFocus]);

  return (
    <div ref={containerRef} className="rounded-[var(--radius-xl)] bg-[var(--color-panel)] py-2">
      <div className="flex flex-wrap items-center gap-2 px-5 pt-2">
        {showDomainSelect ? (
          <Select value={domainProfileKey} onValueChange={setDomainProfileKey}>
            <SelectTrigger aria-label="研究领域 Profile" size="sm" className="min-w-36 bg-[var(--color-bg)] text-xs text-[var(--color-text-secondary)]">
              <SelectValue placeholder="选择研究领域" />
            </SelectTrigger>
            <SelectContent position="popper" align="start">
              <SelectGroup>
                <SelectLabel>研究领域</SelectLabel>
                {domainProfiles.map((profile) => (
                  <SelectItem key={profile.key} value={profile.key}>
                    {profile.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        ) : null}
        <Select value={budgetProfile} onValueChange={(value) => setBudgetProfile(value as ResearchBudgetProfile)}>
          <SelectTrigger aria-label="研究强度" size="sm" className="min-w-36 bg-[var(--color-bg)] text-xs text-[var(--color-text-secondary)]">
            <SelectValue placeholder="选择研究强度" />
          </SelectTrigger>
          <SelectContent position="popper" align="start">
            <SelectGroup>
              <SelectLabel>研究强度</SelectLabel>
              {BUDGET_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <ChatInput
        onSend={(message, attachments) =>
          onSend(message, attachments, {
            budgetProfile,
            commanderModel,
            ...(showDomainSelect ? { domainProfileKey } : {}),
          })
        }
        disabled={disabled}
        model={commanderModel}
        onModelChange={setCommanderModel}
        availableModels={availableModels ?? undefined}
        contextHint={contextHint}
        placeholder="输入一个研究问题，例如：比较两种方法在近五年公开证据中的适用边界"
      />
    </div>
  );
}
