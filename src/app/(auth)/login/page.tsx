"use client";

import { Suspense, useId, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("from") || "/chat";
  const errorId = useId();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<"email" | "password" | null>(null);

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
        setErrorField("password");
        setIsLoading(false);
        return;
      }

      router.push(callbackUrl);
      router.refresh();
    } catch {
      setError("登录异常，请稍后重试");
      setErrorField(null);
      setIsLoading(false);
    }
  }

  return (
    <AuthShell
      title="LumenLab"
      subtitle="登录你的账户"
      footer={
        <>
          还没有账户？{" "}
          <Link
            href="/register"
            className="inline-flex min-h-11 min-w-11 items-center justify-center px-1 text-[var(--color-accent)] transition-colors hover:text-[var(--color-accent-hover)]"
          >
            注册
          </Link>
        </>
      }
    >
      <form method="post" onSubmit={handleSubmit} className="space-y-4">
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
            aria-invalid={errorField === "email" || undefined}
            aria-describedby={error ? errorId : undefined}
          />
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="password"
            className="block text-sm font-medium text-[var(--color-text-primary)]"
          >
            密码
          </label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            placeholder="••••••••"
            className="font-mono"
            aria-invalid={errorField === "password" || undefined}
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
              登录中…
            </>
          ) : (
            "登录"
          )}
        </Button>
      </form>
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <LoginForm />
    </Suspense>
  );
}
