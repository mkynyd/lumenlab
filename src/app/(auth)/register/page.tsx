"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";

export default function RegisterPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    const name = form.get("name") as string;
    const email = form.get("email") as string;
    const password = form.get("password") as string;

    if (password.length < 8) {
      setError("密码至少需要 8 个字符");
      setIsLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name: name || undefined }),
      });

      if (!res.ok) {
        const data = await res.json();
        if (res.status === 409) {
          setError("该邮箱已被注册");
        } else if (data.error?.email) {
          setError(data.error.email[0]);
        } else {
          setError("注册失败，请稍后重试");
        }
        setIsLoading(false);
        return;
      }

      // 注册成功 → 跳转到登录页
      router.push("/login?registered=true");
    } catch {
      setError("网络异常，请稍后重试");
      setIsLoading(false);
    }
  }

  return (
    <div className="w-full max-w-sm">
      {/* 品牌标识 */}
      <div className="text-center mb-8">
        <h1 className="text-xl font-semibold tracking-tight text-[var(--color-text-primary)]">
          Light AI Chat
        </h1>
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
          创建新账户
        </p>
      </div>

      {/* 注册卡片 */}
      <div className="border border-[var(--color-border)] rounded-[var(--radius-lg)] bg-[var(--color-surface)] p-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="name"
              className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5"
            >
              昵称
            </label>
            <input
              id="name"
              name="name"
              type="text"
              autoComplete="name"
              className={cn(
                "w-full h-10 px-3 text-sm rounded-[var(--radius-md)]",
                "border border-[var(--color-border)]",
                "bg-[var(--color-bg)] text-[var(--color-text-primary)]",
                "placeholder:text-[var(--color-text-tertiary)]",
                "focus:outline-none focus:border-[var(--color-accent)]",
                "transition-colors duration-150"
              )}
              placeholder="你的昵称（选填）"
            />
          </div>

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
              autoComplete="new-password"
              required
              minLength={8}
              className={cn(
                "w-full h-10 px-3 text-sm rounded-[var(--radius-md)]",
                "border border-[var(--color-border)]",
                "bg-[var(--color-bg)] text-[var(--color-text-primary)]",
                "placeholder:text-[var(--color-text-tertiary)]",
                "focus:outline-none focus:border-[var(--color-accent)]",
                "transition-colors duration-150",
                "font-mono"
              )}
              placeholder="至少 8 个字符"
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
                创建中…
              </>
            ) : (
              "创建账户"
            )}
          </button>
        </form>
      </div>

      {/* 底部链接 */}
      <p className="text-center mt-6 text-sm text-[var(--color-text-secondary)]">
        已有账户？{" "}
        <Link
          href="/login"
          className="text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] transition-colors"
        >
          登录
        </Link>
      </p>
    </div>
  );
}
