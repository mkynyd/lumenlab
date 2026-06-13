import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  mono?: boolean; // Use monospace font for API keys, tokens, etc.
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, mono = false, type, ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        className={cn(
          "h-10 px-3 text-sm rounded-[var(--radius-md)]",
          "border border-[var(--color-border)]",
          "bg-[var(--color-bg)] text-[var(--color-text-primary)]",
          "placeholder:text-[var(--color-text-tertiary)]",
          "focus:outline-none focus:border-[var(--color-accent)]",
          "transition-colors duration-150",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          mono && "font-mono",
          className
        )}
        {...props}
      />
    );
  }
);

Input.displayName = "Input";
