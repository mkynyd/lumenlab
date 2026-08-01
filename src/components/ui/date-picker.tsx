"use client"

import * as React from "react"
import { format } from "date-fns"
import { CalendarIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

export interface DatePickerProps {
  id?: string;
  /** ISO date "YYYY-MM-DD", or null when nothing is selected. */
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
}

/**
 * shadcn-style date picker: a Calendar inside a Popover, exposed through a
 * plain button trigger so the surrounding goal form keeps a stable label and
 * ISO date string contract. Dates are parsed and formatted in the local
 * timezone to avoid day-offset surprises.
 */
export function DatePicker({
  id,
  value,
  onChange,
  placeholder = "选择日期",
  disabled,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);
  const selectedDate = value ? new Date(`${value}T00:00:00`) : undefined;

  const handleSelect = (date: Date | undefined) => {
    if (!date) {
      onChange(null);
      return;
    }
    onChange(format(date, "yyyy-MM-dd"));
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          id={id}
          disabled={disabled}
          className={cn(
            "h-8 w-full justify-start gap-2 rounded-[var(--radius-md)] bg-[var(--color-interaction-hover)] px-2.5 font-normal text-left hover:bg-[var(--color-surface-active)] focus-visible:bg-[var(--color-surface-active)]",
            value
              ? "text-foreground"
              : "text-[var(--color-text-tertiary)]"
          )}
        >
          <CalendarIcon className="size-4 shrink-0" />
          {selectedDate ? format(selectedDate, "yyyy-MM-dd") : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selectedDate}
          onSelect={handleSelect}
          captionLayout="dropdown"
          autoFocus
        />
      </PopoverContent>
    </Popover>
  );
}
