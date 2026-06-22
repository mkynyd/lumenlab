"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { Info, FileText, Files, MessageSquare, Bookmark } from "lucide-react";

interface ProjectDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectName: string;
  projectType: string;
  fileCount: number;
  conversationCount: number;
  artifactCount: number;
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
  fileCount,
  conversationCount,
  artifactCount,
}: ProjectDetailModalProps) {
  const [tab, setTab] = useState<Tab>("overview");

  const tabs: Array<{ id: Tab; label: string; icon: typeof Info }> = [
    { id: "overview", label: "概览", icon: Info },
    { id: "prompt", label: "系统提示词", icon: FileText },
  ];

  // 类型别名用于 icon prop；实际传入的是 lucide-react 组件
  type IconComponent = typeof Info;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(960px,calc(100vw-2rem))] h-[70vh] p-0 gap-0 overflow-hidden sm:max-w-[960px] rounded-3xl flex flex-col">
        <div className="flex flex-1 min-h-0">
          {/* Left sidebar — neutral surface, no border */}
          <nav className="w-52 shrink-0 bg-[var(--color-panel)] py-5 px-3 flex flex-col gap-0.5">
            <DialogTitle className="px-3 pb-3 text-sm font-semibold text-[var(--color-text-primary)] truncate">
              {projectName}
            </DialogTitle>
            {tabs.map((item) => (
              <button
                key={item.id}
                onClick={() => setTab(item.id)}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2 text-sm rounded-xl text-left w-full",
                  "transition-colors duration-150",
                  tab === item.id
                    ? "bg-[var(--color-interaction-active)] text-[var(--color-text-primary)] font-medium"
                    : "text-[var(--color-text-secondary)] hover:bg-[var(--color-interaction-hover)] hover:text-[var(--color-text-primary)]"
                )}
              >
                <item.icon size={16} strokeWidth={1.5} />
                {item.label}
              </button>
            ))}
          </nav>

          {/* Right content — soft surface, generous spacing */}
          <ScrollArea className="flex-1 min-w-0 bg-[var(--color-bg)]">
            {tab === "overview" && (
              <div className="px-8 py-6 space-y-5">
                <div className="pb-3 border-b border-[var(--color-border-light)]">
                  <h2 className="text-base font-semibold text-[var(--color-text-primary)] tracking-tight">
                    概览
                  </h2>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <StatCard
                    icon={<Files size={18} strokeWidth={1.6} />}
                    label="资料数量"
                    value={fileCount}
                  />
                  <StatCard
                    icon={<MessageSquare size={18} strokeWidth={1.6} />}
                    label="对话数量"
                    value={conversationCount}
                  />
                  <StatCard
                    icon={<Bookmark size={18} strokeWidth={1.6} />}
                    label="成果数量"
                    value={artifactCount}
                  />
                </div>

                <div className="space-y-4 pt-1">
                  <div>
                    <p className="text-xs text-[var(--color-text-tertiary)] mb-1.5">项目名称</p>
                    <p className="text-sm font-medium text-[var(--color-text-primary)]">
                      {projectName}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-[var(--color-text-tertiary)] mb-1.5">项目类型</p>
                    <p className="text-sm text-[var(--color-text-primary)]">
                      {TYPE_LABELS[projectType] || projectType}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {tab === "prompt" && (
              <div className="px-8 py-6 space-y-5">
                <div className="pb-3 border-b border-[var(--color-border-light)]">
                  <h2 className="text-base font-semibold text-[var(--color-text-primary)] tracking-tight">
                    系统提示词
                  </h2>
                </div>

                <div className="rounded-2xl bg-[var(--color-project-control)] p-5">
                  <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
                    在「系统提示词」标签下查看项目专属提示词。
                  </p>
                </div>
              </div>
            )}
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-2xl bg-[var(--color-project-control)] p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--color-text-tertiary)]">{label}</span>
        <span className="text-[var(--color-text-tertiary)]">{icon}</span>
      </div>
      <p className="mt-2 text-2xl font-semibold text-[var(--color-text-primary)] tracking-tight tabular-nums">
        {value}
      </p>
    </div>
  );
}