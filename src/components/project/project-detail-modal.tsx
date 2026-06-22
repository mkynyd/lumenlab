"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { FileText, Settings, Info } from "lucide-react";

interface ProjectDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectName: string;
  projectType: string;
  systemPrompt?: string | null;
}

const TYPE_LABELS: Record<string, string> = {
  experiment: "实验工作台",
  review: "资料复习",
  coding: "代码项目",
  general: "通用项目",
};

type Tab = "overview" | "prompt";

export function ProjectDetailModal({
  open,
  onOpenChange,
  projectName,
  projectType,
  systemPrompt,
}: ProjectDetailModalProps) {
  const [tab, setTab] = useState<Tab>("overview");

  const tabs: Array<{ id: Tab; label: string; icon: typeof Info }> = [
    { id: "overview", label: "概览", icon: Info },
    { id: "prompt", label: "系统提示词", icon: FileText },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(920px,calc(100vw-2rem))] sm:max-w-[920px] h-[70vh] p-0 gap-0 overflow-hidden flex flex-col">
        <div className="flex flex-1 min-h-0">
          {/* Left sidebar */}
          <nav className="w-40 shrink-0 border-r border-[var(--color-panel-muted)] bg-[var(--color-panel)] py-4 flex flex-col">
            <DialogTitle className="px-4 pb-4 text-sm font-semibold text-[var(--color-text-primary)] truncate">
              {projectName}
            </DialogTitle>
            {tabs.map((item) => (
              <button
                key={item.id}
                onClick={() => setTab(item.id)}
                className={cn(
                  "flex items-center gap-2.5 px-4 py-2 text-sm transition-colors duration-150 text-left w-full",
                  tab === item.id
                    ? "bg-[var(--color-accent-muted)] text-[var(--color-accent)] font-medium"
                    : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-interaction-hover)]"
                )}
              >
                <item.icon size={16} strokeWidth={1.5} />
                {item.label}
              </button>
            ))}
          </nav>

          {/* Right content */}
          <ScrollArea className="flex-1 min-w-0">
            {tab === "overview" && (
              <div className="p-6 space-y-5">
                <div>
                  <p className="text-xs text-[var(--color-text-tertiary)] mb-1">项目名称</p>
                  <p className="text-sm font-medium text-[var(--color-text-primary)]">{projectName}</p>
                </div>
                <div>
                  <p className="text-xs text-[var(--color-text-tertiary)] mb-1">项目类型</p>
                  <p className="text-sm text-[var(--color-text-primary)]">{TYPE_LABELS[projectType] || projectType}</p>
                </div>
                <div>
                  <p className="text-xs text-[var(--color-text-tertiary)] mb-1">系统提示词</p>
                  {systemPrompt ? (
                    <div className="rounded-[var(--radius-md)] bg-[var(--color-project-control)] p-3">
                      <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed whitespace-pre-wrap">
                        {systemPrompt}
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs text-[var(--color-text-tertiary)] italic">未设置</p>
                  )}
                </div>
              </div>
            )}

            {tab === "prompt" && (
              <div className="p-6">
                {systemPrompt ? (
                  <div className="rounded-[var(--radius-md)] bg-[var(--color-project-control)] p-4">
                    <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed whitespace-pre-wrap">
                      {systemPrompt}
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
                    <Settings size={28} strokeWidth={1.5} className="text-[var(--color-text-tertiary)]" />
                    <div>
                      <p className="text-sm text-[var(--color-text-primary)] font-medium">未设置系统提示词</p>
                      <p className="text-xs text-[var(--color-text-secondary)] mt-1">
                        在新建项目时提供场景描述，AI 会自动生成专属提示词。
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
