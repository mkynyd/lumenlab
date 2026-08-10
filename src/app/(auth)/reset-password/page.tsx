"use client";

import { Suspense, useId, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";

/** ticket 即邮件中的一次性 token（<id>.<raw>），与后端 resetPasswordSchema 对齐 */
const TICKET_PATTERN = /^[^\s]{1,100}\.[^\s]{1,100}$/;

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const errorId = useId();

  const ticketParam = searchParams.get("ticket") ?? "";
  const hasValidTicket = TICKET_PATTERN.test(ticketParam);

  const [isLoading, setIsLoading] = useState(false);
  const [isInvalid, setIsInvalid] = useState(!hasValidTicket);
  const [error, setError] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<"password" | "confirm" | null>(
    null
  );

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    const password = form.get("password") as string;
    const confirmPassword = form.get("confirmPassword") as string;

    if (password.length < 8) {
      setError("密码至少需要 8 个字符");
      setErrorField("password");
      setIsLoading(false);
      return;
    }
    if (password !== confirmPassword) {
      setError("两次输入的密码不一致");
      setErrorField("confirm");
      setIsLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/auth/password/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket: ticketParam, password }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 429) {
          setError("请求太频繁，请稍后再试");
          setErrorField(null);
        } else if (
          typeof data.error === "object" &&
          data.error?.ticket?.[0]
        ) {
          // 链接失效/过期/已使用：后端文案 + 切换为重新申请视图
          setError(data.error.ticket[0]);
          setErrorField(null);
          setIsInvalid(true);
        } else {
          setError(
            typeof data.error === "string" ? data.error : "重设失败，请稍后重试"
          );
          setErrorField(null);
        }
        setIsLoading(false);
        return;
      }

      router.push("/login?reset=done");
    } catch {
      setError("网络异常，请稍后重试");
      setErrorField(null);
      setIsLoading(false);
    }
  }

  return (
    <AuthShell
      title="LumenLab"
      subtitle="设置新密码"
      footer={
        <>
          <Link
            href="/login"
            className="inline-flex min-h-11 min-w-11 items-center justify-center px-1 text-[var(--color-accent)] transition-colors hover:text-[var(--color-accent-hover)]"
          >
            返回登录
          </Link>
        </>
      }
    >
      {isInvalid ? (
        <div className="space-y-4">
          <p
            id={errorId}
            className="text-sm text-[var(--color-error)]"
            role="alert"
          >
            {error ?? "重设链接已失效或已过期，请重新申请"}
          </p>
          <Link
            href="/forgot-password"
            className="inline-flex h-9 w-full items-center justify-center rounded-[var(--radius-md)] text-sm font-medium bg-[var(--color-accent)] text-[var(--color-accent-contrast)] hover:bg-[var(--color-accent-hover)] transition-colors duration-150"
          >
            重新申请
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="password"
              className="block text-sm font-medium text-[var(--color-text-primary)]"
            >
              新密码
            </label>
            <PasswordInput
              id="password"
              name="password"
              autoComplete="new-password"
              required
              minLength={8}
              placeholder="至少 8 个字符"
              className="font-mono"
              aria-invalid={errorField === "password" || undefined}
              aria-describedby={error ? errorId : undefined}
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="confirmPassword"
              className="block text-sm font-medium text-[var(--color-text-primary)]"
            >
              确认新密码
            </label>
            <PasswordInput
              id="confirmPassword"
              name="confirmPassword"
              autoComplete="new-password"
              required
              minLength={8}
              placeholder="再次输入新密码"
              className="font-mono"
              aria-invalid={errorField === "confirm" || undefined}
              aria-describedby={error ? errorId : undefined}
            />
          </div>

          {error && (
            <p
              id={errorId}
              className="text-sm text-[var(--color-error)]"
              role="alert"
            >
              {error}
            </p>
          )}

          <Button
            type="submit"
            disabled={isLoading}
            className="w-full h-9 rounded-[var(--radius-md)]"
          >
            {isLoading ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                提交中…
              </>
            ) : (
              "重设密码"
            )}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <ResetPasswordForm />
    </Suspense>
  );
}
