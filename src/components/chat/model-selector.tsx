"use client";

import { useState } from "react";
import { Check, ChevronDown, Coins, Layers, Paperclip, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { MODEL_CATALOG_ENTRIES, type ModelCatalogEntry } from "@/lib/chat/model-catalog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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

/** 详情栏内容：官方口径简介 + 可核实的参数（上下文/输入/价格）。 */
function ModelDetail({
  entry,
  reasoningEffort,
  onReasoningEffortChange,
}: {
  entry: ModelCatalogEntry;
  reasoningEffort: ReasoningEffort;
  onReasoningEffortChange?: (effort: ReasoningEffort) => void;
}) {
  return (
    <div className="flex w-full flex-col gap-3">
      <div>
        <p className="text-sm font-medium text-[var(--color-text-primary)]">
          {entry.detailName ?? entry.displayName}
        </p>
        <p className="text-xs text-[var(--color-text-tertiary)]">{entry.vendor}</p>
      </div>
      <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">
        {entry.description}
      </p>
      <dl className="space-y-1.5 text-sm">
        <div className="flex items-center justify-between gap-3">
          <dt className="flex items-center gap-1.5 text-[var(--color-text-tertiary)]">
            <Layers className="size-3.5" strokeWidth={2} />
            上下文
          </dt>
          <dd className="text-[var(--color-text-primary)]">
            {entry.contextWindowTokens >= 1_000_000
              ? `${entry.contextWindowTokens / 1_000_000}M tokens`
              : `${Math.round(entry.contextWindowTokens / 1000)}K tokens`}
          </dd>
        </div>
        {entry.inputLabel && (
          <div className="flex items-center justify-between gap-3">
            <dt className="flex items-center gap-1.5 text-[var(--color-text-tertiary)]">
              <Paperclip className="size-3.5" strokeWidth={2} />
              输入
            </dt>
            <dd className="text-[var(--color-text-primary)]">{entry.inputLabel}</dd>
          </div>
        )}
        {entry.priceNote && (
          <div className="flex items-start justify-between gap-3">
            <dt className="flex items-center gap-1.5 text-[var(--color-text-tertiary)]">
              <Coins className="size-3.5" strokeWidth={2} />
              价格
            </dt>
            <dd className="max-w-[11rem] text-right text-xs leading-relaxed text-[var(--color-text-secondary)]">
              {entry.priceNote}
            </dd>
          </div>
        )}
      </dl>
      {onReasoningEffortChange && (
        <div className="space-y-1.5">
          <p className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-[var(--color-text-tertiary)]">
            <Zap className="size-3.5" strokeWidth={2} />
            思考深度
          </p>
          <div className="grid grid-cols-2 gap-1">
            {EFFORTS.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => onReasoningEffortChange(item.value)}
                className={cn(
                  "h-8 rounded-[var(--radius-md)] text-sm text-[var(--color-text-secondary)] transition-colors",
                  reasoningEffort === item.value
                    ? "bg-[var(--color-surface)] font-medium text-[var(--color-text-primary)]"
                    : "hover:bg-[var(--color-interaction-hover)]"
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
          <p className="text-xs leading-relaxed text-[var(--color-text-tertiary)]">
            {EFFORTS.find((item) => item.value === reasoningEffort)?.hint}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * 模型选择器：左侧模型列表 + 右侧官方口径详情栏（悬浮预览，选中即详情）。
 * 模型与思考深度是两个独立分组，切换模型不动思考深度，反之亦然。
 */
export function ModelSelector({
  model,
  onChange,
  reasoningEffort = "max",
  onReasoningEffortChange,
  disabled = false,
  compact = false,
  className,
  availableModels = ["deepseek-v4-flash-vision-exp", "minimax-m3"],
}: ModelSelectorProps) {
  const models = MODELS.filter((item) => availableModels.includes(item.value));
  const current = models.find((item) => item.value === model) ?? models[0];
  const triggerLabel = current?.label ?? model;
  const [mobileOpen, setMobileOpen] = useState(false);
  const [previewed, setPreviewed] = useState<string | null>(null);
  const detailEntry = catalogEntry(previewed ?? current?.value ?? "");

  const triggerClassName = cn(
    "h-8 shrink-0 rounded-[var(--radius-lg)] bg-[var(--color-panel-muted)] px-3 text-sm font-normal text-[var(--color-text-primary)] hover:bg-[var(--color-interaction-hover)] focus-visible:bg-[var(--color-interaction-active)]",
    compact && "max-w-[min(72vw,14rem)]",
    className
  );

  return (
    <>
    <div className="hidden md:block">
    <DropdownMenu onOpenChange={(open) => { if (!open) setPreviewed(null); }}>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          className={triggerClassName}
          aria-label="选择模型"
        >
          <span className="truncate">{triggerLabel}</span>
          <ChevronDown data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      {/* 单一大卡片：覆盖默认 max-h/overflow（滚动条）与内边距，
          左白右灰两个平铺区域，圆角由外层 overflow-hidden 统一裁剪。
          右区固定高度：不同模型简介换行数不同，若跟随内容变化，
          弹层会在 hover 时反复 resize 重定位，导致列表抖动。 */}
      <DropdownMenuContent
        align="start"
        sideOffset={8}
        className="h-[27.5rem] w-[38rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-[var(--radius-xl)] p-0"
      >
        <div className="flex h-full">
          <div className="w-56 shrink-0 py-2">
            <DropdownMenuLabel className="px-3 py-2 text-sm font-normal text-[var(--color-text-tertiary)]">
              模型
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={current?.value}
              onValueChange={onChange}
            >
              {models.map((item) => {
                const entry = catalogEntry(item.value);
                return (
                  <DropdownMenuRadioItem
                    key={item.value}
                    value={item.value}
                    onMouseEnter={() => setPreviewed(item.value)}
                    onFocus={() => setPreviewed(item.value)}
                    className="h-12 rounded-[var(--radius-md)] px-3"
                  >
                    <span className="flex flex-col gap-0.5">
                      <span className="text-base leading-tight">{item.label}</span>
                      <span className="text-xs leading-tight text-[var(--color-text-tertiary)]">
                        {entry?.vendor}
                      </span>
                    </span>
                  </DropdownMenuRadioItem>
                );
              })}
            </DropdownMenuRadioGroup>
          </div>
          {detailEntry && (
            <div className="h-full flex-1 bg-[var(--color-panel-muted)] p-5">
              <ModelDetail
                entry={detailEntry}
                reasoningEffort={reasoningEffort}
                onReasoningEffortChange={onReasoningEffortChange}
              />
            </div>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
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
        className="top-auto bottom-0 left-0 max-w-none -translate-x-0 -translate-y-0 gap-3 rounded-t-xl rounded-b-none p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:max-w-none"
      >
        <DialogHeader>
          <DialogTitle>选择模型</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <p className="px-1 text-xs text-[var(--color-text-tertiary)]">模型</p>
          <div className="space-y-1">
            {models.map((item) => {
              const entry = catalogEntry(item.value);
              const active = current?.value === item.value;
              return (
                <Button
                  key={item.value}
                  type="button"
                  variant="ghost"
                  className={cn(
                    "h-auto w-full justify-start rounded-[var(--radius-md)] px-3 py-2.5",
                    active && "bg-[var(--color-interaction-active)] text-[var(--color-text-primary)]"
                  )}
                  onClick={() => {
                    onChange(item.value);
                    setMobileOpen(false);
                  }}
                >
                  <span className="flex flex-1 flex-col items-start gap-0.5 text-left">
                    <span className="text-base">{item.label}</span>
                    <span className="text-xs text-[var(--color-text-tertiary)]">
                      {entry?.vendor}
                    </span>
                    {entry?.description && (
                      <span className="line-clamp-2 text-xs leading-relaxed text-[var(--color-text-tertiary)]">
                        {entry.description}
                      </span>
                    )}
                  </span>
                  {active && <Check data-icon="inline-end" />}
                </Button>
              );
            })}
          </div>
        </div>
        {onReasoningEffortChange && (
          <div className="space-y-2">
            <p className="px-1 text-xs text-[var(--color-text-tertiary)]">思考深度</p>
            <div className="grid grid-cols-2 gap-2">
              {EFFORTS.map((item) => (
                <Button
                  key={item.value}
                  type="button"
                  variant="ghost"
                  className={cn(
                    "h-11 justify-start rounded-[var(--radius-md)] px-3",
                    reasoningEffort === item.value && "bg-[var(--color-interaction-active)] text-[var(--color-text-primary)]"
                  )}
                  onClick={() => onReasoningEffortChange(item.value)}
                >
                  {item.label}
                  {reasoningEffort === item.value && <Check data-icon="inline-end" />}
                </Button>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
    </>
  );
}
