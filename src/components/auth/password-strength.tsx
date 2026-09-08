import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

interface PasswordStrengthProps {
  password: string;
  id?: string;
}

const LETTER_PATTERN = /\p{L}/u;
const NUMBER_PATTERN = /\p{N}/u;
const SYMBOL_PATTERN = /[^\p{L}\p{N}\s]/u;

const STRENGTH_LEVELS = [
  { label: "尚未输入", color: "bg-[var(--color-panel-muted)]" },
  { label: "较弱", color: "bg-[var(--color-error)]" },
  { label: "一般", color: "bg-[var(--color-warning)]" },
  { label: "良好", color: "bg-[var(--color-accent)]" },
  { label: "强", color: "bg-[var(--color-success)]" },
] as const;

export function evaluatePasswordStrength(password: string) {
  const checks = [
    { label: "至少 8 个字符", met: password.length >= 8 },
    {
      label: "同时包含字母和数字",
      met: LETTER_PATTERN.test(password) && NUMBER_PATTERN.test(password),
    },
    { label: "包含至少 1 个符号", met: SYMBOL_PATTERN.test(password) },
    { label: "建议达到 12 个字符", met: password.length >= 12 },
  ];

  return {
    checks,
    score: password.length === 0 ? 0 : checks.filter((check) => check.met).length,
  };
}

export function PasswordStrength({ password, id }: PasswordStrengthProps) {
  const { checks, score } = evaluatePasswordStrength(password);
  const level = STRENGTH_LEVELS[score];

  return (
    <div id={id} className="space-y-3" aria-live="polite">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="text-[var(--color-text-tertiary)]">密码强度</span>
        <span className="font-medium text-[var(--color-text-secondary)]">
          {level.label}
        </span>
      </div>

      <div
        className="flex gap-1.5"
        role="meter"
        aria-label="密码强度"
        aria-valuemin={0}
        aria-valuemax={4}
        aria-valuenow={score}
        aria-valuetext={level.label}
      >
        {checks.map((check, index) => (
          <span
            key={check.label}
            aria-hidden
            className={cn(
              "h-1.5 flex-1 rounded-full transition-colors duration-200",
              index < score
                ? level.color
                : "bg-[var(--color-panel-muted)]"
            )}
          />
        ))}
      </div>

      <ul className="grid gap-x-5 gap-y-2 sm:grid-cols-2">
        {checks.map((check) => (
          <li
            key={check.label}
            aria-label={`${check.label}：${check.met ? "已满足" : "未满足"}`}
            className={cn(
              "flex items-center gap-2 text-xs leading-5",
              check.met
                ? "text-[var(--color-success)]"
                : "text-[var(--color-text-tertiary)]"
            )}
          >
            <span className="flex size-4 shrink-0 items-center justify-center">
              {check.met ? (
                <Check aria-hidden className="size-3.5" strokeWidth={2.25} />
              ) : (
                <Minus aria-hidden className="size-3.5" />
              )}
            </span>
            <span>{check.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
