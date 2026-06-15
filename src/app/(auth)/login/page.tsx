"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("from") || "/chat";

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    const email = form.get("email") as string;
    const password = form.get("password") as string;

    try {
      const result = await signIn("login", {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        setError("邮箱或密码错误，请重试");
        setIsLoading(false);
        return;
      }

      router.push(callbackUrl);
      router.refresh();
    } catch {
      setError("登录异常，请稍后重试");
      setIsLoading(false);
    }
  }

  return (
    <div className="w-full max-w-sm">
      {/* 品牌标识 */}
      <div className="text-center mb-8">
        <h1 className="text-xl font-semibold tracking-tight text-[var(--color-text-primary)]">
          course-ai-lab
        </h1>
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
          登录你的账户
        </p>
      </div>

      {/* 登录卡片 */}
      <div className="border border-[var(--color-border)] rounded-[var(--radius-lg)] bg-[var(--color-surface)] p-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5"
            >
              邮箱
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className={cn(
                "w-full h-10 px-3 text-sm rounded-[var(--radius-md)]",
                "border border-[var(--color-border)]",
                "bg-[var(--color-bg)] text-[var(--color-text-primary)]",
                "placeholder:text-[var(--color-text-tertiary)]",
                "focus:outline-none focus:border-[var(--color-accent)]",
                "transition-colors duration-150"
              )}
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5"
            >
              密码
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className={cn(
                "w-full h-10 px-3 text-sm rounded-[var(--radius-md)]",
                "border border-[var(--color-border)]",
                "bg-[var(--color-bg)] text-[var(--color-text-primary)]",
                "placeholder:text-[var(--color-text-tertiary)]",
                "focus:outline-none focus:border-[var(--color-accent)]",
                "transition-colors duration-150",
                "font-mono"
              )}
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="text-sm text-[var(--color-error)]" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className={cn(
              "w-full h-10 rounded-[var(--radius-md)] text-sm font-medium",
              "bg-[var(--color-accent)] text-white",
              "hover:bg-[var(--color-accent-hover)]",
              "disabled:opacity-50 disabled:cursor-not-allowed",
              "transition-colors duration-150",
              "flex items-center justify-center gap-2"
            )}
          >
            {isLoading ? (
              <>
                <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                登录中…
              </>
            ) : (
              "登录"
            )}
          </button>
        </form>
      </div>

      {/* 底部链接 */}
      <p className="text-center mt-6 text-sm text-[var(--color-text-secondary)]">
        还没有账户？{" "}
        <Link
          href="/register"
          className="text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] transition-colors"
        >
          注册
        </Link>
      </p>
    </div>
  );
}
