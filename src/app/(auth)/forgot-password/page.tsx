"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function ForgotPasswordPage() {
  const errorId = useId();
  const [isLoading, setIsLoading] = useState(false);
  const [isSent, setIsSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    const email = form.get("email") as string;

    try {
      const res = await fetch("/api/auth/password/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 429) {
          setError("请求太频繁，请稍后再试");
        } else {
          setError(
            typeof data.error === "string" ? data.error : "提交失败，请稍后重试"
          );
        }
        setIsLoading(false);
        return;
      }

      // 后端恒返回成功（防枚举），文案不区分邮箱是否存在
      setIsSent(true);
    } catch {
      setError("网络异常，请稍后重试");
      setIsLoading(false);
    }
  }

  return (
    <AuthShell
      title="LumenLab"
      subtitle="重置密码"
      footer={
        <>
          想起来了？{" "}
          <Link
            href="/login"
            className="inline-flex min-h-11 min-w-11 items-center justify-center px-1 text-[var(--color-accent)] transition-colors hover:text-[var(--color-accent-hover)]"
          >
            返回登录
          </Link>
        </>
      }
    >
      {isSent ? (
        <div className="space-y-4">
          <p
            className="rounded-[var(--radius-md)] bg-[var(--color-success-muted)] px-3 py-2 text-sm text-[var(--color-success)]"
            role="status"
          >
            如果该邮箱已注册，重设邮件已发送
          </p>
          <p className="text-sm text-[var(--color-text-secondary)]">
            请查收邮件并点击其中的重设链接。链接有时效，过期可在本页重新申请。
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="email"
              className="block text-sm font-medium text-[var(--color-text-primary)]"
            >
              邮箱
            </label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="you@example.com"
              aria-describedby={error ? errorId : undefined}
            />
            <p className="text-xs text-[var(--color-text-tertiary)]">
              输入注册时使用的邮箱，我们将发送密码重设邮件
            </p>
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
                发送中…
              </>
            ) : (
              "发送重设邮件"
            )}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
