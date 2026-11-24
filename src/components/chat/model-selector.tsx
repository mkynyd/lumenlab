"use client";

import { useId, useState } from "react";
import { Check, ChevronDown, Gauge, Layers, Paperclip, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { DEFAULT_CHAT_MODELS, MODEL_CATALOG_ENTRIES, type ModelCatalogEntry } from "@/lib/chat/model-catalog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

type ReasoningEffort = "high" | "max";

interface ModelSelectorProps {
  model: string;
  onChange: (model: string) => void;
  reasoningEffort?: ReasoningEffort;
  onReasoningEffortChange?: (effort: ReasoningEffort) => void;
  disabled?: boolean;
  compact?: boolean;
  className?: string;
  /** Authenticated server catalog; Qwen is omitted until its rollout is enabled. */
  availableModels?: readonly string[];
}

// 选项来自服务端模型目录：活跃模型在前，历史别名保留标签供旧会话展示
const MODELS = MODEL_CATALOG_ENTRIES.map((entry) => ({
  value: entry.id,
  label: entry.displayName,
}));

const EFFORTS: Array<{ value: ReasoningEffort; label: string; hint: string }> = [
  { value: "high", label: "快速", hint: "跳过深度思考，直接回答。" },
  { value: "max", label: "深度", hint: "回答前进行更完整的推理。" },
];

function catalogEntry(id: string): ModelCatalogEntry | undefined {
  return MODEL_CATALOG_ENTRIES.find((entry) => entry.id === id);
}

function ModelDetail({ entry }: { entry: ModelCatalogEntry }) {
  return (
    <div className="flex flex-col gap-3 px-2 pb-2 pt-1">
      <div className="shrink-0">
        <p className="text-sm font-medium text-[var(--color-text-primary)]">
          {entry.detailName ?? entry.displayName}
        </p>
        <p className="text-xs text-[var(--color-text-tertiary)]">{entry.vendor}</p>
      </div>
      <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">
        {entry.description}
      </p>
      <dl className="flex shrink-0 flex-col gap-1.5 text-sm">
        <div className="flex h-5 items-center justify-between gap-3">
          <dt className="flex items-center gap-1.5 text-[var(--color-text-tertiary)]">
            <Layers className="size-4 shrink-0" strokeWidth={1.75} />
            上下文
          </dt>
          <dd className="text-[var(--color-text-primary)]">
            {entry.contextWindowTokens >= 1_000_000
              ? `${entry.contextWindowTokens / 1_000_000}M tokens`
              : `${Math.round(entry.contextWindowTokens / 1000)}K tokens`}
          </dd>
        </div>
        <div className="flex h-5 items-center justify-between gap-3">
          <dt className="flex items-center gap-1.5 text-[var(--color-text-tertiary)]">
            <Gauge className="size-4 shrink-0" strokeWidth={1.75} />
            最大输出
          </dt>
          <dd className="text-[var(--color-text-primary)]">
            {entry.maxOutputTokens >= 1_000_000
              ? `${entry.maxOutputTokens / 1_000_000}M tokens`
              : `${Math.round(entry.maxOutputTokens / 1000)}K tokens`}
          </dd>
        </div>
        {entry.inputLabel && (
          <div className="flex h-5 items-center justify-between gap-3">
            <dt className="flex items-center gap-1.5 text-[var(--color-text-tertiary)]">
              <Paperclip className="size-4 shrink-0" strokeWidth={1.75} />
              输入
            </dt>
            <dd className="text-[var(--color-text-primary)]">{entry.inputLabel}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

function ReasoningControls({
  reasoningEffort,
  onReasoningEffortChange,
}: {
  reasoningEffort: ReasoningEffort;
  onReasoningEffortChange: (effort: ReasoningEffort) => void;
}) {
  const effortSegments = reasoningEffort === "max" ? 5 : 2;
  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-lg)] bg-[var(--color-control)] p-3">
    <p className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-[var(--color-text-tertiary)]">
      <Zap className="size-3.5" strokeWidth={2} />
      思考深度
    </p>
    <div className="flex gap-1" aria-hidden="true" data-testid="reasoning-meter">
      {[0, 1, 2, 3, 4].map((segment) => (
        <span
          key={segment}
          className={cn(
            "h-1.5 flex-1 rounded-full transition-colors duration-200 ease-out motion-reduce:transition-none",
            segment < effortSegments
              ? "bg-[var(--color-accent)]"
              : "bg-[var(--color-border-light)]"
          )}
        />
      ))}
    </div>
    <ToggleGroup
      type="single"
      value={reasoningEffort}
      onValueChange={(value) => {
        if (value) onReasoningEffortChange(value as ReasoningEffort);
      }}
      spacing={1}
      className="grid grid-cols-2 rounded-[var(--radius-md)] bg-[var(--color-panel-muted)] p-1"
      aria-label="思考深度"
    >
      {EFFORTS.map((item) => (
        <ToggleGroupItem
          key={item.value}
          value={item.value}
          className="h-9 rounded-full text-xs data-[state=on]:bg-[var(--color-surface)] data-[state=on]:text-[var(--color-text-primary)]"
        >
          {item.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
    <p className="text-xs leading-relaxed text-[var(--color-text-tertiary)]">
      {EFFORTS.find((item) => item.value === reasoningEffort)?.hint}
    </p>
  </div>
  );
}

export function ModelSelector({
  model,
  onChange,
  reasoningEffort = "max",
  onReasoningEffortChange,
  disabled = false,
  compact = false,
  className,
  availableModels = DEFAULT_CHAT_MODELS,
}: ModelSelectorProps) {
  const models = MODELS.filter((item) => availableModels.includes(item.value));
  const current = models.find((item) => item.value === model) ?? MODELS.find((item) => item.value === model);
  const triggerLabel = current?.label ?? model;
  const [desktopOpen, setDesktopOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsId = useId();
  const detailEntry = catalogEntry(current?.value ?? "");

  const triggerClassName = cn(
    "h-8 shrink-0 rounded-full bg-[var(--color-panel-muted)] px-2.5 text-[13px] font-medium text-[var(--color-text-primary)] transition-[background-color,color,transform] hover:bg-[var(--color-interaction-hover)] active:scale-[0.97] focus-visible:bg-[var(--color-interaction-active)]",
    compact && "max-w-[min(72vw,14rem)]",
    className
  );

  return (
    <>
    <div className="hidden md:block">
      <Popover open={desktopOpen} onOpenChange={(open) => {
        setDesktopOpen(open);
        if (!open) setDetailsOpen(false);
      }}>
        <PopoverTrigger asChild disabled={disabled}>
          <Button type="button" variant="ghost" size="sm" className={triggerClassName} aria-label="选择模型">
            <span className="truncate">{triggerLabel}</span>
            <ChevronDown
              data-icon="inline-end"
              className={cn("transition-transform motion-reduce:transition-none", desktopOpen && "rotate-180")}
            />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          side={compact ? "top" : "bottom"}
          sideOffset={8}
          aria-label="模型与思考深度"
          className="chat-composer-popover max-h-[var(--radix-popover-content-available-height)] max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-[var(--radius-xl)] border-0 p-2"
        >
          <ToggleGroup
            type="single"
            value={current?.value ?? ""}
            onValueChange={(value) => { if (value) onChange(value); }}
            aria-label="模型"
            orientation="vertical"
            spacing={1}
            className="grid w-full gap-0.5"
          >
            {models.map((item) => (
              <ToggleGroupItem
                key={item.value}
                value={item.value}
                className="h-10 w-full justify-between rounded-[var(--radius-md)] px-2.5 text-sm data-[state=on]:bg-[var(--color-interaction-active)]"
              >
                {item.label}
                {current?.value === item.value && <Check className="size-4" aria-hidden />}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          {onReasoningEffortChange && (
            <div className="mt-2">
              <ReasoningControls reasoningEffort={reasoningEffort} onReasoningEffortChange={onReasoningEffortChange} />
            </div>
          )}
          {detailEntry && (
            <div className="mt-1">
              <button
                type="button"
                aria-controls={detailsId}
                aria-expanded={detailsOpen}
                onClick={() => setDetailsOpen((open) => !open)}
                className="flex h-9 w-full items-center justify-between rounded-[var(--radius-md)] px-2 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-interaction-hover)] focus-visible:bg-[var(--color-interaction-active)] focus-visible:outline-none"
              >
                模型详情
                <ChevronDown className={cn("size-4 transition-transform motion-reduce:transition-none", detailsOpen && "rotate-180")} aria-hidden />
              </button>
              <div
                id={detailsId}
                inert={!detailsOpen}
                aria-hidden={!detailsOpen}
                data-expanded={detailsOpen}
                className="chat-model-details"
              >
                <div className="min-h-0 overflow-hidden" data-testid="model-detail-card">
                  <ModelDetail entry={detailEntry} />
                </div>
              </div>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>

    <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
      <DialogTrigger asChild disabled={disabled}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          className={cn("h-10 max-w-[min(56vw,15rem)] md:hidden", triggerClassName)}
          aria-label="选择模型"
        >
          <span className="truncate">{triggerLabel}</span>
          <ChevronDown data-icon="inline-end" />
        </Button>
      </DialogTrigger>
      <DialogContent
        className="chat-composer-sheet top-auto bottom-0 left-0 max-h-[85dvh] max-w-none -translate-x-0 -translate-y-0 gap-4 overflow-y-auto rounded-t-[24px] rounded-b-none border-0 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[var(--shadow-input)] sm:max-w-none"
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>配置</DialogTitle>
        </DialogHeader>
        <div className="grid gap-1">
          {models.map((item) => {
            const active = current?.value === item.value;
            return (
              <button
                key={item.value}
                type="button"
                className={cn(
                  "flex min-h-11 w-full items-center justify-between gap-3 rounded-[var(--radius-md)] px-3 text-left hover:bg-[var(--color-interaction-hover)]",
                  active ? "bg-[var(--color-interaction-active)] text-[var(--color-text-primary)]" : "text-[var(--color-text-secondary)]"
                )}
                aria-pressed={active}
                onClick={() => onChange(item.value)}
              >
                <span className="truncate text-sm">{item.label}</span>
                {active && <Check className="size-4 shrink-0" strokeWidth={2} />}
              </button>
            );
          })}
        </div>
        {onReasoningEffortChange && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-[var(--color-text-secondary)]">思考深度</span>
            <ToggleGroup
              type="single"
              value={reasoningEffort}
              onValueChange={(value) => {
                if (value) onReasoningEffortChange(value as ReasoningEffort);
              }}
              spacing={1}
              className="grid grid-cols-2 rounded-[var(--radius-md)] bg-[var(--color-panel-muted)] p-1"
              aria-label="思考深度"
            >
              {EFFORTS.map((item) => (
                <ToggleGroupItem
                  key={item.value}
                  value={item.value}
                  className="h-8 rounded-[var(--radius-sm)] px-4 text-sm data-[state=on]:bg-[var(--color-surface)] data-[state=on]:text-[var(--color-text-primary)]"
                >
                  {item.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        )}
        <Button
          type="button"
          className="h-11 w-full rounded-full text-base"
          onClick={() => setMobileOpen(false)}
        >
          完成
        </Button>
      </DialogContent>
    </Dialog>
    </>
  );
}
