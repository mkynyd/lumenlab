"use client";

import { useId, useRef, useState } from "react";
import { CalendarDays, Clock, Upload } from "lucide-react";
import { format } from "date-fns";
import { zhCN } from "react-day-picker/locale";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Info, TriangleAlert } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function StudyTip({
  content,
  children,
}: {
  content: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent>{content}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function StudyFeedback({
  message,
  error = false,
}: {
  message: string;
  error?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div role={error ? "alert" : "status"}>
      <span className="sr-only">{message}</span>
      <TooltipProvider>
        <Tooltip open={open} onOpenChange={setOpen}>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant={error ? "destructive" : "secondary"}
              onClick={(event) => {
                event.preventDefault();
                setOpen(true);
              }}
            >
              {error ? <TriangleAlert /> : <Info />}
              {error ? "查看错误" : "查看提示"}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{message}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

export function StudyCheck({
  checked,
  onChange,
  disabled,
  children,
  hint,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  children: React.ReactNode;
  hint?: string;
}) {
  const id = useId();
  const control = (
    <Checkbox
      id={id}
      checked={checked}
      onCheckedChange={(value) => onChange(value === true)}
      disabled={disabled}
      className="size-auto min-h-10 justify-start gap-2 px-3 py-2 text-left text-sm font-medium data-checked:bg-[var(--color-accent-muted)] data-checked:text-[var(--color-accent)]"
    >
      {children}
    </Checkbox>
  );
  return hint ? <StudyTip content={hint}>{control}</StudyTip> : control;
}

export function StudySelect({
  value,
  onChange,
  options,
  label,
  name,
  disabled,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  label: string;
  name?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Select
      value={value}
      onValueChange={onChange}
      name={name}
      disabled={disabled}
    >
      <SelectTrigger
        aria-label={label}
        className={cn(
          "h-10 w-full min-w-0 bg-[var(--color-interaction-hover)] px-3 hover:bg-[var(--color-interaction-active)] focus-visible:bg-[var(--color-interaction-active)]",
          className,
        )}
      >
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent position="popper" align="start">
        <SelectGroup>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

/** Study-local composition: the shared DatePicker uses native caption dropdowns. */
export function StudyDatePicker({
  value,
  onChange,
  label,
  name,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  name?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const date = value ? new Date(`${value}T00:00:00`) : undefined;
  return (
    <>
      <input type="hidden" name={name} value={value} />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="secondary"
            disabled={disabled}
            aria-label={label}
            className="h-10 w-full justify-start px-3 font-normal"
          >
            <CalendarDays />
            {date ? format(date, "yyyy年M月d日") : label}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-2">
          <Calendar
            locale={zhCN}
            mode="single"
            captionLayout="label"
            defaultMonth={date}
            selected={date}
            onSelect={(selected) => {
              onChange(selected ? format(selected, "yyyy-MM-dd") : "");
              setOpen(false);
            }}
            autoFocus
          />
        </PopoverContent>
      </Popover>
    </>
  );
}

export function StudyTimePicker({
  value,
  onChange,
  label,
  name,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  name?: string;
  disabled?: boolean;
}) {
  const [hour, minute] = value.split(":");
  return (
    <>
      <input type="hidden" name={name} value={value} />
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="secondary"
            disabled={disabled}
            aria-label={label}
            className="h-10 w-full justify-start px-3 font-normal"
          >
            <Clock />
            {value || label}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64">
          <p className="mb-3 text-sm font-medium">{label}</p>
          <div className="grid grid-cols-2 gap-2">
            <StudySelect
              label={`${label}小时`}
              value={hour || ""}
              onChange={(h) => onChange(`${h}:${minute || "00"}`)}
              options={Array.from({ length: 24 }, (_, i) => ({
                value: String(i).padStart(2, "0"),
                label: `${String(i).padStart(2, "0")} 时`,
              }))}
            />
            <StudySelect
              label={`${label}分钟`}
              value={minute || ""}
              onChange={(m) => onChange(`${hour || "00"}:${m}`)}
              options={Array.from({ length: 60 }, (_, i) => ({
                value: String(i).padStart(2, "0"),
                label: `${String(i).padStart(2, "0")} 分`,
              }))}
            />
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}

export function StudyDateTime({
  value,
  onChange,
  label,
  name,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  name?: string;
  disabled?: boolean;
}) {
  const [date = "", time = ""] = value.split("T");
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_115px] gap-2">
      <input
        type="hidden"
        name={name}
        value={date && time ? `${date}T${time}` : ""}
      />
      <StudyDatePicker
        value={date}
        onChange={(d) => onChange(`${d}T${time}`)}
        label={`${label}日期`}
        disabled={disabled}
      />
      <StudyTimePicker
        value={time}
        onChange={(t) => onChange(`${date}T${t}`)}
        label={`${label}时间`}
        disabled={disabled}
      />
    </div>
  );
}

export function UploadButton({
  label,
  busyLabel = "正在处理…",
  variant = "secondary",
  className,
  ...props
}: React.ComponentProps<"input"> & {
  label: string;
  busyLabel?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  className?: string;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className={cn("min-w-0", className)}>
      <Button
        type="button"
        variant={variant}
        disabled={props.disabled}
        className="h-10 px-4"
        onClick={() => input.current?.click()}
      >
        <Upload />
        {props.disabled ? busyLabel : label}
      </Button>
      <input
        {...props}
        ref={input}
        id={id}
        type="file"
        className="sr-only"
        aria-label={label}
        tabIndex={-1}
      />
    </div>
  );
}
