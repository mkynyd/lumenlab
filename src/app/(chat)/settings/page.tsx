"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Key, AlertTriangle, Check } from "lucide-react";

export default function SettingsPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isSetup = searchParams.get("setup") === "true";

  const [apiKeys, setApiKeys] = useState({
    deepseek: "",
    minimax: "",
  });
  const [saving, setSaving] = useState<"deepseek" | "minimax" | null>(null);
  const [keyInfo, setKeyInfo] = useState<Record<
    string,
    { hasKey: boolean; keyPrefix?: string; createdAt?: string }
  >>({});
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const fetchKeyInfo = useCallback(async () => {
    try {
      const res = await fetch("/api/keys");
      if (res.ok) {
        const data = await res.json();
        setKeyInfo(data.providers || {});
      }
    } catch {
      // 静默处理
    }
  }, []);

  useEffect(() => {
    fetchKeyInfo();
  }, [fetchKeyInfo]);

  async function saveKey(
    e: React.FormEvent,
    provider: "deepseek" | "minimax"
  ) {
    e.preventDefault();
    setSaving(provider);
    setMessage(null);

    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, key: apiKeys[provider].trim() }),
      });

      const data = await res.json();

      if (res.ok) {
        setMessage({ type: "success", text: "API Key 已安全保存" });
        setApiKeys((current) => ({ ...current, [provider]: "" }));
        fetchKeyInfo();
        if (isSetup) {
          if (provider === "deepseek") router.push("/chat");
        }
      } else {
        const errMsg =
          typeof data.error === "string"
            ? data.error
            : data.error?.key?.[0] || "保存失败，请重试";
        setMessage({ type: "error", text: errMsg });
      }
    } catch {
      setMessage({ type: "error", text: "网络异常，请检查连接后重试" });
    } finally {
      setSaving(false);
    }
  }

  async function deleteKey(provider: "deepseek" | "minimax") {
    if (!confirm("确定要移除 API Key 吗？移除后将无法使用聊天功能。")) return;

    try {
      const res = await fetch(`/api/keys?provider=${provider}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setMessage({ type: "success", text: "API Key 已移除" });
        setKeyInfo((current) => {
          const next = { ...current };
          delete next[provider];
          return next;
        });
      }
    } catch {
      setMessage({ type: "error", text: "移除失败，请重试" });
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-lg mx-auto px-4 py-8 space-y-8">
        {/* 首次设置提示 */}
        {isSetup && (
          <div
            className={cn(
              "flex items-start gap-3 p-4 rounded-[var(--radius-md)]",
              "border border-[var(--color-warning)]/30",
              "bg-[var(--color-warning-muted)]"
            )}
          >
            <AlertTriangle
              size={18}
              strokeWidth={2}
              className="text-[var(--color-warning)] shrink-0 mt-0.5"
            />
            <div>
              <p className="text-sm font-medium text-[var(--color-text-primary)]">
                需要配置 API Key
              </p>
              <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
                请先添加你的 DeepSeek API Key 以开始使用。你的密钥将使用 AES-256-GCM 加密存储。
              </p>
            </div>
          </div>
        )}

        <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">
          设置
        </h1>

        {/* API Key 配置 */}
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Key size={16} strokeWidth={2} className="text-[var(--color-text-tertiary)]" />
            <h2 className="text-sm font-medium text-[var(--color-text-primary)]">
              API Key
            </h2>
          </div>

          {/* 当前密钥状态 */}
          {(["deepseek", "minimax"] as const).map((provider) => {
            const info = keyInfo[provider];
            const label = provider === "deepseek" ? "DeepSeek" : "MiniMax";
            const href =
              provider === "deepseek"
                ? "https://platform.deepseek.com/api_keys"
                : "https://platform.minimaxi.com/";
            return (
              <div key={provider} className="space-y-3">
                {info?.hasKey && (
                  <div
                    className={cn(
                      "flex items-center justify-between p-3 rounded-[var(--radius-md)]",
                      "border border-[var(--color-border)] bg-[var(--color-surface)]"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Check size={14} className="text-[var(--color-success)]" />
                      <span className="text-sm font-mono">{info.keyPrefix}</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteKey(provider)}
                    >
                      移除
                    </Button>
                  </div>
                )}
                <form
                  onSubmit={(event) => saveKey(event, provider)}
                  className="space-y-3"
                >
                  <div>
                    <label
                      htmlFor={`${provider}-apikey`}
                      className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1"
                    >
                      {label} API Key
                    </label>
                    <Input
                      id={`${provider}-apikey`}
                      type="password"
                      mono
                      placeholder={provider === "deepseek" ? "sk-..." : "输入 MiniMax Key"}
                      value={apiKeys[provider]}
                      onChange={(event) =>
                        setApiKeys((current) => ({
                          ...current,
                          [provider]: event.target.value,
                        }))
                      }
                      autoComplete="off"
                    />
                    <p className="mt-1 text-[11px] text-[var(--color-text-tertiary)]">
                      在{" "}
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[var(--color-accent)] hover:underline"
                      >
                        {provider === "deepseek"
                          ? "platform.deepseek.com"
                          : "platform.minimaxi.com"}
                      </a>{" "}
                      获取 Key
                    </p>
                  </div>
                  <Button
                    type="submit"
                    variant="primary"
                    isLoading={saving === provider}
                    disabled={!apiKeys[provider].trim()}
                  >
                    {info?.hasKey ? `更新 ${label} Key` : `保存 ${label} Key`}
                  </Button>
                </form>
                {provider === "deepseek" && (
                  <hr className="border-[var(--color-border-light)]" />
                )}
              </div>
            );
          })}

          {/* 安全提示 */}
          <div className="text-[11px] text-[var(--color-text-tertiary)] space-y-1">
            <p>AES-256-GCM 加密 · 你的 API Key 加密存储，安全无虞</p>
            <p>密钥隔离 · 保存后密钥不会明文返回前端</p>
          </div>

          {message && (
            <p
              className={cn(
                "text-sm",
                message.type === "success"
                  ? "text-[var(--color-success)]"
                  : "text-[var(--color-error)]"
              )}
            >
              {message.text}
            </p>
          )}
        </section>

        {/* 分割线 */}
        <hr className="border-[var(--color-border)]" />

        {/* 外观设置 */}
        <section className="space-y-4">
          <h2 className="text-sm font-medium text-[var(--color-text-primary)]">
            外观
          </h2>
          <div className="flex items-center justify-between p-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
            <span className="text-sm text-[var(--color-text-secondary)]">
              主题
            </span>
            <ThemeToggle />
          </div>
        </section>

        {/* 分割线 */}
        <hr className="border-[var(--color-border)]" />

        {/* 账户信息 */}
        <section className="space-y-4">
          <h2 className="text-sm font-medium text-[var(--color-text-primary)]">
            账户
          </h2>
          <div className="p-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-xs text-[var(--color-text-tertiary)]">邮箱</span>
              <span className="text-sm text-[var(--color-text-primary)]">
                {session?.user?.email}
              </span>
            </div>
            {session?.user?.name && (
              <div className="flex justify-between items-center">
                <span className="text-xs text-[var(--color-text-tertiary)]">昵称</span>
                <span className="text-sm text-[var(--color-text-primary)]">
                  {session.user.name}
                </span>
              </div>
            )}
          </div>

          <Button
            variant="danger"
            size="sm"
            onClick={() => signOut({ callbackUrl: "/login" })}
          >
            退出登录
          </Button>
        </section>
      </div>
    </div>
  );
}
