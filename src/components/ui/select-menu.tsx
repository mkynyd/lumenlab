"use client";

import { Check, NavArrowDown, NavArrowRight } from "iconoir-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface SelectMenuOption {
  value: string;
  label: string;
}

interface SelectMenuProps {
  value?: string;
  placeholder: string;
  options: SelectMenuOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  ariaLabel: string;
  labelAlign?: "left" | "center";
  className?: string;
}

export function SelectMenu({
  value,
  placeholder,
  options,
  onChange,
  disabled,
  ariaLabel,
  labelAlign = "left",
  className,
}: SelectMenuProps) {
  const selected = options.find((option) => option.value === value);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          size="md"
          disabled={disabled}
          aria-label={ariaLabel}
          className={cn(
            "relative w-full min-w-0 justify-between",
            labelAlign === "center" ? "text-center" : "text-left",
            className
          )}
        >
          <span
            className={cn(
              "min-w-0 truncate",
              labelAlign === "center" ? "w-full px-4 text-center" : "flex-1 text-left"
            )}
          >
            {selected?.label || placeholder}
          </span>
          <NavArrowDown
            data-icon="inline-end"
            strokeWidth={1.9}
            className={cn(labelAlign === "center" && "absolute right-3")}
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="workbench-border-glow"
        aria-label={ariaLabel}
      >
        <DropdownMenuGroup>
          {options.map((option) => (
            <DropdownMenuItem
              key={option.value}
              onSelect={() => onChange(option.value)}
              className={cn(
                "justify-start text-left text-[var(--color-text-primary)]",
                option.value === value &&
                  "bg-[var(--color-interaction-active)] text-[var(--color-text-primary)]"
              )}
            >
              {option.value === value ? (
                <Check className="text-[var(--color-accent)]" strokeWidth={2} />
              ) : (
                <NavArrowRight className="text-[var(--color-text-secondary)]" strokeWidth={2} />
              )}
              {option.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
