"use client";

import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type PasswordInputProps = Omit<
  React.ComponentProps<typeof Input>,
  "type" | "inputMode" | "spellCheck" | "autoCapitalize"
>;

/**
 * Keeps passwords masked by default while offering a text-mode escape hatch.
 * macOS and some mobile browsers disable IME composition in type="password";
 * showing the password temporarily lets users enter an existing Unicode secret.
 */
function PasswordInput({ className, ...props }: PasswordInputProps) {
  const [isVisible, setIsVisible] = React.useState(false);
  const toggleLabel = isVisible
    ? "隐藏密码"
    : "显示密码并允许使用中文输入法";

  return (
    <div className="relative">
      <Input
        {...props}
        type={isVisible ? "text" : "password"}
        inputMode="text"
        spellCheck={false}
        autoCapitalize="none"
        className={cn("pr-10", className)}
      />
      <button
        type="button"
        aria-label={toggleLabel}
        title={toggleLabel}
        aria-pressed={isVisible}
        onClick={() => setIsVisible((visible) => !visible)}
        className="absolute inset-y-0 right-0 inline-flex w-10 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-tertiary)] outline-none transition-colors hover:bg-[var(--color-interaction-hover)] hover:text-[var(--color-text-primary)] focus-visible:bg-[var(--color-interaction-hover)] focus-visible:text-[var(--color-text-primary)]"
      >
        {isVisible ? (
          <EyeOff aria-hidden="true" size={16} />
        ) : (
          <Eye aria-hidden="true" size={16} />
        )}
      </button>
    </div>
  );
}

export { PasswordInput };
