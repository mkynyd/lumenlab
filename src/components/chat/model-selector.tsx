"use client";

import { useMemo, useState } from "react";
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
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Provider = "deepseek" | "minimax" | "bailian";
type Strength = "fast" | "advanced";
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

const STRENGTHS: Array<{ value: Strength; label: string; effort: ReasoningEffort }> = [
  { value: "fast", label: "快速", effort: "high" },
  { value: "advanced", label: "深度", effort: "max" },
];

const PROVIDERS: Array<{ value: Provider; label: string }> = [
  { value: "deepseek", label: "DeepSeek" },
  { value: "minimax", label: "MiniMax" },
  { value: "bailian", label: "Qwen3.7-Plus" },
];

function providerFor(model: string): Provider {
  if (model === "qwen3.7-plus") return "bailian";
  return model === "minimax-m3" ? "minimax" : "deepseek";
}

function strengthFor(model: string, effort: ReasoningEffort): Strength {
  if (model === "deepseek-v4-flash") return "fast";
  if (effort === "max") return "advanced";
  return "fast";
}

function modelFor(provider: Provider, strength: Strength) {
  if (provider === "minimax") return "minimax-m3";
  if (provider === "bailian") return "qwen3.7-plus";
  return strength === "fast" ? "deepseek-v4-flash" : "deepseek-v4-pro";
}

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
  const availableProviders = PROVIDERS.filter((item) =>
    availableModels.includes(modelFor(item.value, "advanced")) ||
    availableModels.includes(modelFor(item.value, "fast"))
  );
  const requestedProvider = providerFor(model);
  const provider = availableProviders.some((item) => item.value === requestedProvider)
    ? requestedProvider
    : availableProviders[0]?.value ?? "deepseek";
  const strength = strengthFor(model, reasoningEffort);
  const providerLabel = PROVIDERS.find((item) => item.value === provider)?.label ?? "DeepSeek";
  const strengthLabel = STRENGTHS.find((item) => item.value === strength)?.label ?? "高级";

  const triggerLabel = useMemo(
    () => `${strengthLabel} · ${providerLabel}`,
    [providerLabel, strengthLabel]
  );
  const [mobileOpen, setMobileOpen] = useState(false);

  function setStrength(nextStrength: Strength) {
    const next = STRENGTHS.find((item) => item.value === nextStrength);
    if (!next) return;
    onReasoningEffortChange?.(next.effort);
    onChange(modelFor(provider, nextStrength));
  }

  function setProvider(nextProvider: Provider) {
    onChange(modelFor(nextProvider, strength));
  }

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
          aria-label="选择模型强度和模型"
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
          推理深度
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={strength}
          onValueChange={(value) => setStrength(value as Strength)}
        >
          {STRENGTHS.map((item) => (
            <DropdownMenuRadioItem
              key={item.value}
              value={item.value}
              className="h-10 rounded-[var(--radius-md)] px-3 text-base"
            >
              {item.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator className="mx-3 my-2" />
        <DropdownMenuGroup>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="h-10 rounded-[var(--radius-md)] px-3 text-base">
              <span className="flex-1">模型</span>
              <span className="text-sm text-[var(--color-text-tertiary)]">
                {providerLabel}
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-52 rounded-[var(--radius-xl)] p-2 max-md:data-[side=right]:-translate-x-[calc(100%+0.5rem)]">
              {availableProviders.map((item) => (
                <DropdownMenuItem
                  key={item.value}
                  onSelect={() => setProvider(item.value)}
                  className="h-10 rounded-[var(--radius-md)] px-3 text-base"
                >
                  <span className="flex-1 whitespace-nowrap">{item.label}</span>
                  {provider === item.value && <Check data-icon="inline-end" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuGroup>
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
          className={cn("h-10 max-w-[min(56vw,15rem)]", triggerClassName)}
          aria-label="选择模型强度和模型"
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
          <p className="px-1 text-xs text-[var(--color-text-tertiary)]">推理深度</p>
          <div className="grid grid-cols-2 gap-2">
            {STRENGTHS.map((item) => (
              <Button
                key={item.value}
                type="button"
                variant="ghost"
                className={cn(
                  "h-11 justify-start rounded-[var(--radius-md)] px-3",
                  strength === item.value && "bg-[var(--color-interaction-active)] text-[var(--color-text-primary)]"
                )}
                onClick={() => {
                  setStrength(item.value);
                  setMobileOpen(false);
                }}
              >
                {item.label}
                {strength === item.value && <Check data-icon="inline-end" />}
              </Button>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <p className="px-1 text-xs text-[var(--color-text-tertiary)]">模型服务</p>
          <div className="space-y-1">
            {availableProviders.map((item) => (
              <Button
                key={item.value}
                type="button"
                variant="ghost"
                className={cn(
                  "h-11 w-full justify-start rounded-[var(--radius-md)] px-3",
                  provider === item.value && "bg-[var(--color-interaction-active)] text-[var(--color-text-primary)]"
                )}
                onClick={() => {
                  setProvider(item.value);
                  setMobileOpen(false);
                }}
              >
                <span className="flex-1 text-left">{item.label}</span>
                {provider === item.value && <Check data-icon="inline-end" />}
              </Button>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}
