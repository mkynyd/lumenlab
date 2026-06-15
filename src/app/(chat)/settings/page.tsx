"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Key, AlertTriangle, Check, Database } from "lucide-react";
import {
  useApiKeys,
  useDeleteApiKey,
  useUpdateApiKeys,
} from "@/lib/hooks/use-api-keys";
import { useCacheMetrics } from "@/lib/hooks/use-cache-metrics";

export default function SettingsPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isSetup = searchParams.get("setup") === "true";

  const [apiKeys, setApiKeys] = useState({
    deepseek: "",
    minimax: "",
  });
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const apiKeysQuery = useApiKeys();
  const updateApiKeys = useUpdateApiKeys();
  const deleteApiKey = useDeleteApiKey();
  const keyInfo = apiKeysQuery.data?.providers || {};
  const cacheMetrics = useCacheMetrics(7);

  async function saveKey(
    e: React.FormEvent,
    provider: "deepseek" | "minimax"
  ) {
    e.preventDefault();
    setMessage(null);

    try {
      await updateApiKeys.mutateAsync({
        provider,
        key: apiKeys[provider].trim(),
      });
      setMessage({ type: "success", text: "API Key 已安全保存" });
      setApiKeys((current) => ({ ...current, [provider]: "" }));
      if (isSetup && provider === "deepseek") {
        router.push("/chat");
      }
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "网络异常，请检查连接后重试",
      });
    }
  }

  async function deleteKey(provider: "deepseek" | "minimax") {
    if (!confirm("确定要移除 API Key 吗？移除后将无法使用聊天功能。")) return;

    try {
      await deleteApiKey.mutateAsync(provider);
      setMessage({ type: "success", text: "API Key 已移除" });
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
                    isLoading={
                      updateApiKeys.isPending &&
                      updateApiKeys.variables?.provider === provider
                    }
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

        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Database size={16} className="text-[var(--color-text-tertiary)]" />
            <h2 className="text-sm font-medium text-[var(--color-text-primary)]">
              Cache
            </h2>
          </div>
          {cacheMetrics.isPending ? (
            <div className="h-32 animate-pulse rounded-[var(--radius-md)] bg-[var(--color-surface-hover)]" />
          ) : cacheMetrics.data ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
                  <p className="text-[11px] text-[var(--color-text-tertiary)]">
                    近 7 天 Token 命中率
                  </p>
                  <p className="mt-1 text-2xl font-semibold">
                    {(cacheMetrics.data.overall.hitRate * 100).toFixed(1)}%
                  </p>
                  <p className="text-[10px] text-[var(--color-text-tertiary)]">
                    {cacheMetrics.data.overall.requestCount} 条缓存用量记录
                  </p>
                </div>
                <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-xs">
                  {(["deepseek", "minimax"] as const).map((provider) => (
                    <div key={provider} className="flex justify-between py-1">
                      <span className="capitalize">{provider}</span>
                      <span className="font-mono">
                        {(
                          cacheMetrics.data.providers[provider].hitRate * 100
                        ).toFixed(1)}
                        %
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="space-y-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
                <p className="text-xs font-medium">每日 Hit / Miss Tokens</p>
                {cacheMetrics.data.daily.length === 0 ? (
                  <p className="text-xs text-[var(--color-text-tertiary)]">
                    暂无缓存用量数据
                  </p>
                ) : (
                  cacheMetrics.data.daily.map((day) => {
                    const total = day.totalHitTokens + day.totalMissTokens;
                    const hitWidth =
                      total > 0 ? (day.totalHitTokens / total) * 100 : 0;
                    return (
                      <div key={day.date} className="grid grid-cols-[72px_1fr] items-center gap-2">
                        <span className="text-[10px] font-mono">{day.date.slice(5)}</span>
                        <div className="flex h-2 overflow-hidden rounded-full bg-[var(--color-error-muted)]">
                          <span
                            className="bg-[var(--color-success)]"
                            style={{ width: `${hitWidth}%` }}
                          />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
              <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
                {(["markdown", "docx", "pdf"] as const).map((format) => (
                  <div key={format} className="rounded border border-[var(--color-border)] p-2">
                    <p className="font-medium uppercase">{format}</p>
                    <p className="font-mono">
                      {(cacheMetrics.data.exports[format].hitRate * 100).toFixed(1)}%
                    </p>
                  </div>
                ))}
              </div>
              {cacheMetrics.data.overall.requestCount > 0 &&
                cacheMetrics.data.overall.hitRate < 0.8 && (
                  <p className="rounded-[var(--radius-md)] bg-[var(--color-warning-muted)] p-3 text-xs">
                    检测到缓存命中率偏低，可在收集足够基线后评估 Prompt 重排实验。
                  </p>
                )}
              <div className="space-y-2 rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] p-3">
                <p className="text-xs font-medium">实验性功能</p>
                {[
                  {
                    name: "自适应 Prompt 重排",
                    env: "CACHE_EXPERIMENT_PROMPT_REORDER",
                  },
                  {
                    name: "MiniMax Active Cache",
                    env: "CACHE_EXPERIMENT_MINIMAX_ACTIVE",
                  },
                ].map((experiment) => (
                  <div
                    key={experiment.env}
                    className="flex items-center justify-between gap-3 text-xs"
                  >
                    <div>
                      <p>{experiment.name}</p>
                      <p className="font-mono text-[10px] text-[var(--color-text-tertiary)]">
                        {experiment.env}=true
                      </p>
                    </div>
                    <span className="rounded-full bg-[var(--color-surface-hover)] px-2 py-1 text-[10px]">
                      默认关闭
                    </span>
                  </div>
                ))}
                <p className="text-[10px] text-[var(--color-text-tertiary)]">
                  修改 `.env.local` 后重启应用才能启用。建议先收集至少一周基线数据。
                </p>
              </div>
            </>
          ) : (
            <p className="text-xs text-[var(--color-error)]">缓存指标加载失败</p>
          )}
        </section>

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
