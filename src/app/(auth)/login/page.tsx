"use client";

import { Suspense, useId, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("from") || "/chat";
  const errorId = useId();
  const noticeId = useId();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<"email" | "password" | null>(null);

  const notice =
    searchParams.get("reset") === "done"
      ? "密码已重置，请重新登录"
      : searchParams.get("registered") === "true"
        ? "注册成功，请使用邮箱和密码登录"
        : null;

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
        if (result.code === "email_not_verified") {
          setError("该邮箱尚未完成验证，请查收验证邮件并完成注册");
          setErrorField("email");
        } else {
          setError("邮箱或密码错误，请重试");
          setErrorField("password");
        }
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
          <PasswordInput
            id="password"
            name="password"
            autoComplete="current-password"
            required
            placeholder="••••••••"
            className="font-mono"
            aria-invalid={errorField === "password" || undefined}
            aria-describedby={
              error ? `${errorId} login-password-help` : "login-password-help"
            }
          />
          <p
            id="login-password-help"
            className="text-xs leading-5 text-[var(--color-text-tertiary)]"
          >
            密码区分全角与半角符号；需使用中文输入法时，可先点右侧图标显示密码。
          </p>
        </div>

        {notice && (
          <p
            id={noticeId}
            className="rounded-[var(--radius-md)] bg-[var(--color-success-muted)] px-3 py-2 text-sm text-[var(--color-success)]"
            role="status"
          >
            {notice}
          </p>
        )}

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

        <div className="text-center">
          <Link
            href="/forgot-password"
            className="inline-flex min-h-11 min-w-11 items-center justify-center px-1 text-sm text-[var(--color-accent)] transition-colors hover:text-[var(--color-accent-hover)]"
          >
            忘记密码？
          </Link>
        </div>
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
