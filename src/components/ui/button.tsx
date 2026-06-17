import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  isLoading?: boolean;
}

const variantStyles = {
  primary:
    "bg-[var(--color-accent)] text-[var(--color-accent-contrast)] hover:bg-[var(--color-accent-hover)] border-transparent",
  secondary:
    "bg-[var(--color-surface)] text-[var(--color-text-primary)] border-[var(--color-border-light)] hover:bg-[var(--color-surface-hover)] hover:border-[var(--color-accent)]",
  ghost:
    "bg-transparent text-[var(--color-text-secondary)] border-transparent hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]",
  danger:
    "bg-[var(--color-error)] text-[var(--color-accent-contrast)] hover:opacity-90 border-transparent",
};

const sizeStyles = {
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-9 px-3.5 text-sm gap-2",
  lg: "h-11 px-5 text-sm gap-2.5",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "secondary",
      size = "md",
      isLoading = false,
      disabled,
      children,
      ...props
    },
    ref
  ) => {
    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={cn(
          "inline-flex items-center justify-center font-medium rounded-[var(--radius-md)]",
          "border transition-[background-color,border-color,color,box-shadow,transform] duration-150",
          "disabled:opacity-40 disabled:cursor-not-allowed",
          "focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] focus-visible:outline-offset-2",
          variantStyles[variant],
          sizeStyles[size],
          className
        )}
        {...props}
      >
        {isLoading && (
          <span
            className={cn(
              "inline-block border-2 rounded-full animate-spin",
              size === "sm" ? "w-3 h-3" : "w-4 h-4",
              variant === "primary" || variant === "danger"
                ? "border-[var(--color-accent-contrast)]/30 border-t-[var(--color-accent-contrast)]"
                : "border-[var(--color-text-tertiary)]/30 border-t-[var(--color-text-secondary)]"
            )}
          />
        )}
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";
