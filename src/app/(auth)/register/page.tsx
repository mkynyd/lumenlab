"use client";

import { Suspense, useEffect, useId, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Check, Loader2 } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import { Input } from "@/components/ui/input";
import { Stepper, type Step } from "@/components/ui/stepper";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_PATTERN = /^\d{6}$/;

type ErrorField = "email" | "code" | "password" | "confirm" | null;

function RegisterFlow() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const errorId = useId();

  // 链接通道：/register?verified=1&ticket=<t>&email=<e> 直达密码步；
  // /register?verify=failed 显示链接失效提示。首渲染时从 URL 解析初始状态。
  const linkTicket = searchParams.get("ticket") ?? "";
  const linkEmail = searchParams.get("email") ?? "";
  const isVerifiedLink =
    searchParams.get("verified") === "1" &&
    linkTicket.length > 0 &&
    linkTicket.length <= 200 &&
    EMAIL_PATTERN.test(linkEmail);
  const linkFailed =
    searchParams.get("verify") === "failed" ||
    (searchParams.get("verified") === "1" && !isVerifiedLink);

  const [step, setStep] = useState(() => (isVerifiedLink ? 2 : 0));
  const [email, setEmail] = useState(() => (isVerifiedLink ? linkEmail : ""));
  const [ticket, setTicket] = useState<string | null>(() =>
    isVerifiedLink ? linkTicket : null
  );
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(() =>
    linkFailed ? "验证链接已失效，请重新验证" : null
  );
  const [errorField, setErrorField] = useState<ErrorField>(null);
  const [showLoginLink, setShowLoginLink] = useState(false);
  const [resendLeft, setResendLeft] = useState(0);
  const [isResending, setIsResending] = useState(false);

  // 重新发送倒计时
  useEffect(() => {
    if (resendLeft <= 0) return;
    const timer = window.setInterval(() => {
      setResendLeft((value) => (value > 0 ? value - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendLeft]);

  function fail(message: string, field: ErrorField, loginLink = false): never {
    setError(message);
    setErrorField(field);
    setShowLoginLink(loginLink);
    throw new Error(message);
  }

  async function postJson(url: string, body: Record<string, unknown>) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      resendAfter?: number;
      ticket?: string;
      error?: string | Record<string, string[]>;
    };
    return { res, data };
  }

  /** 发送验证邮件；失败时设置错误并抛出让 Stepper 停留在当前步 */
  async function sendVerification() {
    if (!EMAIL_PATTERN.test(email.trim())) {
      fail("邮箱格式不正确", "email");
    }
    const { res, data } = await postJson("/api/auth/verify/send", {
      email: email.trim(),
    }).catch(() => fail("网络异常，请稍后重试", null));

    if (!res.ok) {
      if (res.status === 409) {
        fail("该邮箱已被注册", "email", true);
      }
      if (res.status === 429) {
        fail("请求太频繁，请稍后再试", null);
      }
      const message =
        typeof data.error === "object" && data.error?.email?.[0]
          ? data.error.email[0]
          : typeof data.error === "string"
            ? data.error
            : "邮件发送失败，请稍后重试";
      fail(message, typeof data.error === "object" ? "email" : null);
    }

    setError(null);
    setErrorField(null);
    setShowLoginLink(false);
    setResendLeft(data.resendAfter ?? 60);
  }

  /** 验证码通道：换取注册 ticket */
  async function verifyCode() {
    if (!CODE_PATTERN.test(code)) {
      fail("验证码应为 6 位数字", "code");
    }
    const { res, data } = await postJson("/api/auth/verify/code", {
      email: email.trim(),
      code,
    }).catch(() => fail("网络异常，请稍后重试", null));

    if (!res.ok) {
      if (res.status === 429) {
        fail("请求太频繁，请稍后再试", null);
      }
      const message =
        typeof data.error === "object" && data.error?.code?.[0]
          ? data.error.code[0]
          : typeof data.error === "string"
            ? data.error
            : "验证失败，请稍后重试";
      fail(message, "code");
    }

    if (!data.ticket) {
      fail("验证失败，请稍后重试", "code");
    }
    setTicket(data.ticket);
    setError(null);
    setErrorField(null);
  }

  /** 最终注册提交 */
  async function submitRegistration() {
    if (password.length < 8) {
      fail("密码至少需要 8 个字符", "password");
    }
    if (password !== confirmPassword) {
      fail("两次输入的密码不一致", "confirm");
    }
    if (!ticket) {
      setStep(0);
      fail("请先完成邮箱验证", null);
    }

    const { res, data } = await postJson("/api/auth/register", {
      email: email.trim(),
      password,
      ticket,
    }).catch(() => fail("网络异常，请稍后重试", null));

    if (!res.ok) {
      if (res.status === 409) {
        setStep(0);
        fail("该邮箱已被注册", "email", true);
      }
      if (res.status === 429) {
        fail("请求太频繁，请稍后再试", null);
      }
      if (typeof data.error === "object" && data.error?.ticket?.[0]) {
        // ticket 非法/过期/已消费：回退到邮箱步重新验证
        setTicket(null);
        setStep(0);
        fail(data.error.ticket[0], null);
      }
      if (typeof data.error === "object" && data.error?.email?.[0]) {
        setStep(0);
        fail(data.error.email[0], "email");
      }
      fail(
        typeof data.error === "string" ? data.error : "注册失败，请稍后重试",
        null
      );
    }
  }

  async function handleStepChange(next: number) {
    if (step === 0 && next === 1) {
      await sendVerification();
    } else if (step === 1 && next === 2) {
      await verifyCode();
    } else if (step === 2 && next === 3) {
      await submitRegistration();
    }
    setStep(next);
  }

  async function handleResend() {
    setIsResending(true);
    setError(null);
    try {
      await sendVerification();
    } catch {
      // 错误已写入 state
    } finally {
      setIsResending(false);
    }
  }

  const errorBlock = error ? (
    <p id={errorId} className="text-sm text-[var(--color-error)]" role="alert">
      {error}
      {showLoginLink && (
        <>
          {" "}
          <Link
            href="/login"
            className="text-[var(--color-accent)] transition-colors hover:text-[var(--color-accent-hover)]"
          >
            去登录
          </Link>
        </>
      )}
    </p>
  ) : null;

  const steps: Step[] = [
    {
      id: "email",
      title: "邮箱",
      isValid: email.trim().length > 0,
      content: (
        <div className="space-y-4">
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
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-invalid={errorField === "email" || undefined}
              aria-describedby={error ? errorId : undefined}
            />
            <p className="text-xs text-[var(--color-text-tertiary)]">
              我们将向该邮箱发送验证邮件（验证码 + 验证链接）
            </p>
          </div>
          {errorBlock}
        </div>
      ),
    },
    {
      id: "verify",
      title: "验证",
      isValid: CODE_PATTERN.test(code),
      content: (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="code"
              className="block text-sm font-medium text-[var(--color-text-primary)]"
            >
              验证码
            </label>
            <Input
              id="code"
              name="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              required
              placeholder="6 位数字验证码"
              className="font-mono tracking-widest"
              value={code}
              onChange={(event) =>
                setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
              }
              aria-invalid={errorField === "code" || undefined}
              aria-describedby={error ? errorId : undefined}
            />
            <p className="text-xs text-[var(--color-text-tertiary)]">
              验证邮件已发送至 {email}，也可以直接点击邮件中的验证链接
            </p>
          </div>
          {errorBlock}
          <button
            type="button"
            onClick={handleResend}
            disabled={resendLeft > 0 || isResending}
            className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] px-3 text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-interaction-hover)] transition-colors duration-150 disabled:opacity-50"
          >
            {isResending && <Loader2 size={14} className="animate-spin" />}
            {resendLeft > 0 ? `重新发送（${resendLeft}s）` : "重新发送"}
          </button>
        </div>
      ),
    },
    {
      id: "password",
      title: "设置密码",
      isValid: password.length >= 8 && confirmPassword.length > 0,
      content: (
        <div className="space-y-4">
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
              autoComplete="new-password"
              required
              minLength={8}
              placeholder="至少 8 个字符"
              className="font-mono"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={errorField === "password" || undefined}
              aria-describedby={error ? errorId : undefined}
            />
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor="confirmPassword"
              className="block text-sm font-medium text-[var(--color-text-primary)]"
            >
              确认密码
            </label>
            <Input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              placeholder="再次输入密码"
              className="font-mono"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              aria-invalid={errorField === "confirm" || undefined}
              aria-describedby={error ? errorId : undefined}
            />
          </div>
          {errorBlock}
        </div>
      ),
    },
    {
      id: "done",
      title: "完成",
      isValid: true,
      content: (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--color-success-muted)] text-[var(--color-success)]">
            <Check size={20} strokeWidth={2.5} />
          </span>
          <p className="text-sm font-medium text-[var(--color-text-primary)]">
            注册成功
          </p>
          <p className="text-sm text-[var(--color-text-secondary)]">
            账户 {email} 已创建，现在可以登录了
          </p>
          <Link
            href="/login?registered=true"
            className="mt-2 inline-flex h-8 items-center rounded-[var(--radius-md)] px-4 text-sm font-medium bg-[var(--color-accent)] text-[var(--color-accent-contrast)] hover:bg-[var(--color-accent-hover)] transition-colors duration-150"
          >
            去登录
          </Link>
        </div>
      ),
    },
  ];

  return (
    <AuthShell
      title="LumenLab"
      subtitle="创建新账户"
      footer={
        <>
          已有账户？{" "}
          <Link
            href="/login"
            className="inline-flex min-h-11 min-w-11 items-center justify-center px-1 text-[var(--color-accent)] transition-colors hover:text-[var(--color-accent-hover)]"
          >
            登录
          </Link>
        </>
      }
    >
      <Stepper
        steps={steps}
        currentStep={step}
        onStepChange={handleStepChange}
        onComplete={() => router.push("/login?registered=true")}
        allowForwardJump={false}
        nextLabel={
          step === 0 ? "发送验证邮件" : step === 1 ? "验证" : "创建账户"
        }
        completeLabel="去登录"
        pendingLabel={
          step === 0 ? "发送中…" : step === 1 ? "验证中…" : "创建中…"
        }
      />
    </AuthShell>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <RegisterFlow />
    </Suspense>
  );
}
