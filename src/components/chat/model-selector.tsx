"use client";

import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
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
  DropdownMenuSeparator,
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

const MODELS = [
  { value: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
  { value: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
  { value: "minimax-m3", label: "MiniMax M3" },
  { value: "qwen3.7-plus", label: "Qwen3.7-Plus" },
] as const;

const EFFORTS: Array<{ value: ReasoningEffort; label: string }> = [
  { value: "high", label: "快速" },
  { value: "max", label: "深度" },
];

/**
 * ChatGPT 式模型选择：模型与思考深度是两个独立分组，
 * 切换模型不动思考深度，调整思考深度也不换模型。
 */
export function ModelSelector({
  model,
  onChange,
  reasoningEffort = "max",
  onReasoningEffortChange,
  disabled = false,
  compact = false,
  className,
  availableModels = ["deepseek-v4-pro", "deepseek-v4-flash", "minimax-m3"],
}: ModelSelectorProps) {
  const models = MODELS.filter((item) => availableModels.includes(item.value));
  const current = models.find((item) => item.value === model) ?? models[0];
  const triggerLabel = current?.label ?? model;
  const [mobileOpen, setMobileOpen] = useState(false);

  const triggerClassName = cn(
    "h-8 shrink-0 rounded-[var(--radius-lg)] bg-[var(--color-panel-muted)] px-3 text-sm font-normal text-[var(--color-text-primary)] hover:bg-[var(--color-interaction-hover)] focus-visible:bg-[var(--color-interaction-active)]",
    compact && "max-w-[min(72vw,14rem)]",
    className
  );

  return (
    <>
    <div className="hidden md:block">
    <DropdownMenu>
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
      <DropdownMenuContent
        align="start"
        sideOffset={8}
        className="w-56 rounded-[var(--radius-xl)] p-2"
      >
        <DropdownMenuLabel className="px-3 py-2 text-sm font-normal text-[var(--color-text-tertiary)]">
          模型
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={current?.value}
          onValueChange={onChange}
        >
          {models.map((item) => (
            <DropdownMenuRadioItem
              key={item.value}
              value={item.value}
              className="h-10 rounded-[var(--radius-md)] px-3 text-base"
            >
              {item.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {onReasoningEffortChange && (
          <>
            <DropdownMenuSeparator className="mx-3 my-2" />
            <DropdownMenuLabel className="px-3 py-2 text-sm font-normal text-[var(--color-text-tertiary)]">
              思考深度
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={reasoningEffort}
              onValueChange={(value) =>
                onReasoningEffortChange(value as ReasoningEffort)
              }
            >
              {EFFORTS.map((item) => (
                <DropdownMenuRadioItem
                  key={item.value}
                  value={item.value}
                  className="h-10 rounded-[var(--radius-md)] px-3 text-base"
                >
                  {item.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </>
        )}
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
            {models.map((item) => (
              <Button
                key={item.value}
                type="button"
                variant="ghost"
                className={cn(
                  "h-11 w-full justify-start rounded-[var(--radius-md)] px-3",
                  current?.value === item.value && "bg-[var(--color-interaction-active)] text-[var(--color-text-primary)]"
                )}
                onClick={() => {
                  onChange(item.value);
                  setMobileOpen(false);
                }}
              >
                <span className="flex-1 text-left">{item.label}</span>
                {current?.value === item.value && <Check data-icon="inline-end" />}
              </Button>
            ))}
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
