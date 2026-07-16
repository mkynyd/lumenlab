"use client";

import { signOut, useSession } from "next-auth/react";
import Link from "next/link";
import { useRef, useState } from "react";
import {
  ArrowUpRight,
  Database,
  KeyRound,
  LogOut,
  Palette,
  ShieldCheck,
  Sparkles,
  Upload,
  UserRound,
} from "lucide-react";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { AvatarMark } from "@/components/user/avatar-mark";
import { useCacheMetrics } from "@/lib/hooks/use-cache-metrics";
import {
  useUploadUserAvatar,
  useUpdateUserProfile,
  useUserProfile,
} from "@/lib/hooks/use-user-profile";
import {
  avatarPresetById,
} from "@/lib/user-profile";
import { cn } from "@/lib/utils";

type TabId = "alpha" | "tokens" | "user" | "appearance";
const MAX_AVATAR_UPLOAD_BYTES = 20 * 1024 * 1024;
const TOKEN_CHART_COLORS = {
  hit: "color-mix(in oklch, var(--color-accent) 24%, var(--color-surface))",
  miss: "color-mix(in oklch, var(--color-accent) 42%, var(--color-surface))",
  output: "var(--color-accent)",
};

function formatTokenCount(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function formatInteger(value: number) {
  return value.toLocaleString("en-US");
}

function niceChartMax(value: number) {
  if (value <= 0) return 0;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude;
}

function formatCurrency(value: number) {
  if (value >= 1) return `¥${value.toFixed(2)}`;
  if (value >= 0.01) return `¥${value.toFixed(4)}`;
  return `¥${value.toFixed(6)}`;
}

function formatDay(date: string) {
  const [, month, day] = date.split("-").map(Number);
  return `${month}-${day}`;
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function buildDateRange(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  const days = Math.max(
    1,
    Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1
  );
  return Array.from({ length: days }, (_, i) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + i);
    return dateKey(date);
  });
}

export function SettingsPanel() {
  const [tab, setTab] = useState<TabId>("alpha");

  const tabs: Array<{ id: TabId; label: string; icon: typeof KeyRound }> = [
    { id: "alpha", label: "服务访问", icon: KeyRound },
    { id: "tokens", label: "用量统计", icon: Database },
    { id: "user", label: "用户", icon: UserRound },
    { id: "appearance", label: "外观", icon: Palette },
  ];

  return (
    <div className="flex h-[min(560px,calc(100vh-4rem))] min-w-0 max-w-full flex-col overflow-hidden sm:flex-row">
      {/* Left sidebar — neutral surface, no border, breathing room */}
      <nav
        className="flex w-full shrink-0 flex-row gap-0.5 overflow-x-auto bg-[var(--color-panel)] px-3 py-3 sm:w-52 sm:flex-col sm:overflow-visible sm:py-5"
        role="tablist"
        aria-label="设置标签页"
      >
        <div className="flex shrink-0 flex-row gap-0.5 sm:flex-col">
          {tabs.map((item) => (
            <button
              key={item.id}
              role="tab"
              aria-selected={tab === item.id}
              aria-controls={`settings-panel-${item.id}`}
              onClick={() => setTab(item.id)}
              className={cn(
                "flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm sm:w-full",
                "transition-colors duration-150",
                tab === item.id
                  ? "bg-[var(--color-interaction-active)] text-[var(--color-text-primary)] font-medium"
                  : "text-[var(--color-text-secondary)] hover:bg-[var(--color-interaction-hover)] hover:text-[var(--color-text-primary)]"
              )}
            >
              <item.icon size={16} strokeWidth={1.5} />
              {item.label}
            </button>
          ))}
        </div>

        <Link
          href="/home"
          className={cn(
            "flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm sm:mt-auto sm:w-full",
            "sm:mt-3",
            "text-[var(--color-text-secondary)] hover:bg-[var(--color-interaction-hover)] hover:text-[var(--color-text-primary)]",
            "transition-colors duration-150"
          )}
        >
          <Sparkles size={16} strokeWidth={1.5} />
          <span className="flex-1">网站介绍</span>
          <ArrowUpRight size={12} strokeWidth={1.5} className="text-[var(--color-text-tertiary)]" />
        </Link>
      </nav>

      {/* Right content — soft surface, generous spacing */}
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden bg-[var(--color-bg)]">
        <div className="min-w-0 px-4 py-5 sm:px-8 sm:py-6">
          {tab === "alpha" && <AlphaSection />}
          {tab === "tokens" && <TokensSection />}
          {tab === "user" && <UserSection />}
          {tab === "appearance" && <AppearanceSection />}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Section shell — gives every tab a consistent title + divider
// ============================================================

function SectionShell({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div id={id} className="space-y-5" role="tabpanel" aria-label={title}>
      <div className="pb-3 border-b border-[var(--color-border-light)]">
        <h2 className="text-base font-semibold text-[var(--color-text-primary)] tracking-tight">
          {title}
        </h2>
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

// ============================================================
// Section Components
// ============================================================

function AlphaSection() {
  const [switchCodeValue, setSwitchCodeValue] = useState("");
  const [switchPending, setSwitchPending] = useState(false);
  const [switchMessage, setSwitchMessage] = useState("");
  const [switchError, setSwitchError] = useState(false);

  async function handleSwitchCode() {
    const code = switchCodeValue.trim();
    if (!code) return;
    setSwitchPending(true);
    setSwitchMessage("");
    setSwitchError(false);
    try {
      const res = await fetch("/api/user/switch-code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSwitchError(true);
        setSwitchMessage(data.error || "更换失败");
      } else {
        setSwitchMessage("注册码更换成功，新模型配置已生效");
        setSwitchCodeValue("");
      }
    } catch {
      setSwitchError(true);
      setSwitchMessage("网络错误，请重试");
    } finally {
      setSwitchPending(false);
    }
  }

  return (
    <SectionShell id="settings-panel-alpha" title="Alpha 服务访问">
      <div className="rounded-2xl bg-[var(--color-project-control)] p-4">
        <div className="flex items-start gap-3">
          <ShieldCheck size={16} className="mt-0.5 shrink-0 text-[var(--color-success)]" />
          <div className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
            API Key 由管理员统一配置。账户通过注册码绑定 Alpha 测试密钥组，无需自行填写。
          </div>
        </div>
      </div>

      <div className="rounded-2xl bg-[var(--color-project-control)] p-4 space-y-3">
        <div>
          <p className="text-sm font-medium text-[var(--color-text-primary)]">更换注册码</p>
          <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
            更换后立即生效，原注册码自动失效
          </p>
        </div>
        <div className="flex gap-2">
          <Input
            type="text"
            value={switchCodeValue}
            onChange={(e) => setSwitchCodeValue(e.target.value)}
            placeholder="XXXX-XXXX-XXXX-XXXX"
            className="flex-1 h-9 rounded-xl font-mono text-sm bg-[var(--color-surface)]"
          />
          <Button
            variant="primary"
            size="md"
            disabled={switchPending || !switchCodeValue.trim()}
            onClick={handleSwitchCode}
            className="rounded-xl px-4"
          >
            {switchPending ? "验证中..." : "更换"}
          </Button>
        </div>
        {switchMessage && (
          <p
            className={cn(
              "text-xs",
              switchError ? "text-[var(--color-error)]" : "text-[var(--color-success)]"
            )}
          >
            {switchMessage}
          </p>
        )}
      </div>
    </SectionShell>
  );
}

function TokensSection() {
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);
  const cacheMetrics = useCacheMetrics("cycle");
  const cycleStart = cacheMetrics.data?.cycle?.start.slice(0, 10);
  const cycleEnd = cacheMetrics.data?.cycle?.end.slice(0, 10);

  const monthDays = cacheMetrics.data
    ? (() => {
        const byDate = new Map(
          cacheMetrics.data.tokenUsage.daily.map((d) => [d.date, d])
        );
        return buildDateRange(
          cycleStart || cacheMetrics.data.tokenUsage.daily[0]?.date || dateKey(new Date()),
          cycleEnd || cacheMetrics.data.tokenUsage.daily.at(-1)?.date || dateKey(new Date())
        ).map((date) => {
          return (
            byDate.get(date) || {
              date,
              totalTokens: 0,
              inputCacheHitTokens: 0,
              inputCacheMissTokens: 0,
              outputTokens: 0,
            }
          );
        });
      })()
    : [];

  const maxTokens = Math.max(...monthDays.map((d) => d.totalTokens), 0);
  const chartMax = niceChartMax(maxTokens);
  const hoveredIndex = hoveredDate
    ? monthDays.findIndex((day) => day.date === hoveredDate)
    : -1;
  const hoveredDay = hoveredIndex >= 0 ? monthDays[hoveredIndex] : null;
  const tooltipLeft =
    hoveredIndex >= 0
      ? Math.min(78, Math.max(22, ((hoveredIndex + 0.5) / monthDays.length) * 100))
      : 50;

  return (
    <SectionShell id="settings-panel-tokens" title="用量统计">
      <p className="text-xs text-[var(--color-text-tertiary)] -mt-2">
        本期 Token 使用情况
      </p>

      {cacheMetrics.isPending ? (
        <Skeleton className="h-24 rounded-2xl" />
      ) : cacheMetrics.data ? (
        <div className="space-y-5">
          <div
            className="grid min-w-0 gap-3"
            style={{
              gridTemplateColumns:
                "repeat(auto-fit, minmax(min(14rem, 100%), 1fr))",
            }}
          >
            <div className="min-w-0 rounded-2xl bg-[var(--color-project-control)] p-4">
              <p className="text-xs text-[var(--color-text-tertiary)]">
                本期总量
              </p>
              <p className="mt-1 break-words text-2xl font-semibold tracking-tight text-[var(--color-text-primary)]">
                {formatTokenCount(cacheMetrics.data.tokenUsage.totalTokens)}
              </p>
              <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">
                今日 {formatTokenCount(cacheMetrics.data.tokenUsage.todayTokens)}
              </p>
            </div>
            <div className="min-w-0 rounded-2xl bg-[var(--color-project-control)] p-4">
              <p className="text-xs text-[var(--color-text-tertiary)]">预估费用</p>
              <p className="mt-1 break-words text-2xl font-semibold tracking-tight text-[var(--color-text-primary)]">
                {formatCurrency(cacheMetrics.data.tokenUsage.estimatedCostCny)}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-[var(--color-text-tertiary)]">
                输入 {formatTokenCount(cacheMetrics.data.tokenUsage.inputTokens)} / 输出{" "}
                {formatTokenCount(cacheMetrics.data.tokenUsage.outputTokens)}
              </p>
            </div>
          </div>

          <div className="min-w-0 space-y-1 rounded-2xl bg-[var(--color-project-control)] p-4">
            <p className="mb-2 text-xs text-[var(--color-text-tertiary)]">
              服务拆分
            </p>
            {(["deepseek", "minimax", "bailian"] as const).map((provider) => (
              <div
                key={provider}
                className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-3 py-0.5 text-sm"
              >
                <span className="min-w-0 text-[var(--color-text-secondary)]">
                  {provider === "deepseek"
                    ? "DeepSeek"
                    : provider === "minimax"
                      ? "MiniMax"
                      : "Qwen"}
                </span>
                <span className="min-w-0 text-right font-mono text-[var(--color-text-primary)]">
                  {cacheMetrics.data.tokenUsage.providers[provider].requestCount > 0 ? (
                    <span className="flex flex-wrap items-baseline justify-end gap-x-2 gap-y-0.5">
                      {formatTokenCount(cacheMetrics.data.tokenUsage.providers[provider].totalTokens)}
                      <span className="text-[var(--color-text-tertiary)]">
                        {formatCurrency(
                          cacheMetrics.data.tokenUsage.providers[provider].estimatedCostCny
                        )}
                      </span>
                    </span>
                  ) : (
                    "--"
                  )}
                </span>
              </div>
            ))}
          </div>

          <div>
            <p className="text-xs text-[var(--color-text-tertiary)] mb-2">
              每日 Token 构成
            </p>
            <div className="min-w-0 overflow-hidden rounded-2xl bg-[var(--color-project-control)] p-4">
              {monthDays.length > 0 ? (
                <div className="min-w-0">
                  <div className="flex items-baseline gap-4">
                    <span className="text-sm font-semibold text-[var(--color-text-primary)]">
                      Tokens
                    </span>
                    <span className="font-mono text-sm tabular-nums text-[var(--color-text-tertiary)]">
                      {formatInteger(cacheMetrics.data.tokenUsage.totalTokens)}
                    </span>
                  </div>

                  <div className="relative mt-4 h-64 min-w-0">
                    <div className="absolute left-0 top-0 w-12 -translate-y-2 text-right font-mono text-xs tabular-nums text-[var(--color-text-tertiary)]">
                      {formatInteger(chartMax)}
                    </div>
                    <div className="absolute bottom-8 left-0 w-12 translate-y-1 text-right font-mono text-xs tabular-nums text-[var(--color-text-tertiary)]">
                      0
                    </div>
                    <div className="absolute left-14 right-0 top-0 border-t border-[var(--color-border-light)]" />
                    <div className="absolute bottom-8 left-14 right-0 border-t border-[var(--color-border-light)]" />

                    <div
                      className="absolute bottom-8 left-14 right-0 top-0 grid items-end gap-1"
                      style={{
                        gridTemplateColumns: `repeat(${monthDays.length}, minmax(4px, 1fr))`,
                      }}
                    >
                      {monthDays.map((day) => {
                        const barHeightPercent =
                          day.totalTokens > 0
                            ? Math.max(2, (day.totalTokens / Math.max(chartMax, 1)) * 100)
                            : 0;
                        const hitHeight =
                          day.totalTokens > 0
                            ? (day.inputCacheHitTokens / day.totalTokens) * 100
                            : 0;
                        const missHeight =
                          day.totalTokens > 0
                            ? (day.inputCacheMissTokens / day.totalTokens) * 100
                            : 0;
                        const outputHeight =
                          day.totalTokens > 0
                            ? (day.outputTokens / day.totalTokens) * 100
                            : 0;
                        const visibleTokens =
                          day.inputCacheHitTokens +
                          day.inputCacheMissTokens +
                          day.outputTokens;
                        const otherInputTokens = Math.max(
                          day.totalTokens - visibleTokens,
                          0
                        );
                        const otherInputHeight =
                          day.totalTokens > 0
                            ? (otherInputTokens / day.totalTokens) * 100
                            : 0;
                        const active = hoveredDate === day.date;
                        return (
                          <button
                            type="button"
                            key={day.date}
                            className="relative flex h-full min-w-0 items-end justify-center rounded-sm focus-visible:bg-[var(--color-interaction-hover)] focus-visible:outline-none"
                            aria-label={`${day.date} 共 ${formatInteger(day.totalTokens)} tokens`}
                            onMouseEnter={() => setHoveredDate(day.date)}
                            onMouseLeave={() => setHoveredDate(null)}
                            onFocus={() => setHoveredDate(day.date)}
                            onBlur={() => setHoveredDate(null)}
                          >
                            {active && (
                              <span className="pointer-events-none absolute bottom-0 top-0 left-1/2 border-l border-dashed border-[var(--color-border-light)]" />
                            )}
                            {barHeightPercent > 0 ? (
                              <div
                                className="flex w-2.5 flex-col-reverse overflow-hidden rounded-t-[4px] sm:w-3"
                                style={{ height: `${barHeightPercent}%` }}
                              >
                                {day.outputTokens > 0 && (
                                  <div
                                    style={{
                                      height: `${outputHeight}%`,
                                      backgroundColor: TOKEN_CHART_COLORS.output,
                                    }}
                                  />
                                )}
                                {day.inputCacheMissTokens > 0 && (
                                  <div
                                    style={{
                                      height: `${missHeight}%`,
                                      backgroundColor: TOKEN_CHART_COLORS.miss,
                                    }}
                                  />
                                )}
                                {otherInputTokens > 0 && (
                                  <div
                                    style={{
                                      height: `${otherInputHeight}%`,
                                      backgroundColor: TOKEN_CHART_COLORS.miss,
                                    }}
                                  />
                                )}
                                {day.inputCacheHitTokens > 0 && (
                                  <div
                                    style={{
                                      height: `${hitHeight}%`,
                                      backgroundColor: TOKEN_CHART_COLORS.hit,
                                    }}
                                  />
                                )}
                              </div>
                            ) : (
                              <span className="mb-0 h-px w-2.5 bg-[var(--color-border-light)] sm:w-3" />
                            )}
                          </button>
                        );
                      })}
                    </div>

                    <div className="absolute bottom-0 left-14 translate-y-1 text-xs text-[var(--color-text-tertiary)]">
                      {formatDay(monthDays[0].date)}
                    </div>
                    <div className="absolute bottom-0 right-0 translate-y-1 text-xs text-[var(--color-text-tertiary)]">
                      {formatDay(monthDays[monthDays.length - 1].date)}
                    </div>

                    {hoveredDay && hoveredDay.totalTokens > 0 && (
                      <div
                        className="pointer-events-none absolute top-3 z-10 min-w-64 -translate-x-1/2 rounded-2xl bg-[var(--color-control-menu)] px-4 py-3 shadow-[var(--shadow-float)]"
                        style={{ left: `${tooltipLeft}%` }}
                      >
                        <div className="mb-2 grid grid-cols-[1fr_auto] gap-6 text-sm font-semibold text-[var(--color-text-primary)]">
                          <span>{hoveredDay.date}</span>
                          <span className="font-mono tabular-nums">
                            {formatInteger(hoveredDay.totalTokens)} tokens
                          </span>
                        </div>
                        {[
                          [
                            "输入（命中缓存）",
                            hoveredDay.inputCacheHitTokens,
                            TOKEN_CHART_COLORS.hit,
                          ],
                          [
                            "输入（未命中缓存）",
                            hoveredDay.inputCacheMissTokens,
                            TOKEN_CHART_COLORS.miss,
                          ],
                          [
                            "输出",
                            hoveredDay.outputTokens,
                            TOKEN_CHART_COLORS.output,
                          ],
                        ].map(([label, value, color]) => (
                          <div
                            key={label}
                            className="grid grid-cols-[auto_1fr_auto] items-center gap-3 py-0.5 text-sm text-[var(--color-text-secondary)]"
                          >
                            <span
                              className="h-3 w-3 rounded-sm"
                              style={{ backgroundColor: color as string }}
                            />
                            <span>{label}</span>
                            <span className="font-mono tabular-nums">
                              {formatInteger(value as number)} tokens
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-[var(--color-text-secondary)]">
                  暂无每日数据
                </p>
              )}
            </div>
          </div>

          <div>
            <p className="text-xs text-[var(--color-text-tertiary)] mb-2">
              RAG 缓存命中率
            </p>
            <div className="rounded-2xl bg-[var(--color-project-control)] p-4 space-y-2">
              {([
                ["search", "检索结果缓存"] as const,
                ["file-select", "文件选择缓存"] as const,
                ["query-embed", "查询向量缓存"] as const,
              ]).map(([key, label]) => {
                const metric = cacheMetrics.data.rag[key];
                const total = metric.hits + metric.misses;
                const rate = total > 0 ? Math.round(metric.hitRate * 100) : 0;
                return (
                  <div key={key} className="flex items-center gap-3 text-sm">
                    <span className="w-24 text-[var(--color-text-secondary)]">{label}</span>
                    <div className="flex-1 h-2 rounded-full bg-[var(--color-surface)] overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[var(--color-success)]"
                        style={{ width: `${rate}%` }}
                      />
                    </div>
                    <span className="w-12 text-right font-mono text-[var(--color-text-primary)]">
                      {total > 0 ? `${rate}%` : "--"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <p className="text-sm text-[var(--color-error)]">加载失败</p>
      )}
    </SectionShell>
  );
}

function AppearanceSection() {
  return (
    <SectionShell id="settings-panel-appearance" title="外观">
      <div className="flex items-center justify-between rounded-2xl bg-[var(--color-project-control)] p-4">
        <span className="text-sm text-[var(--color-text-primary)]">主题</span>
        <ThemeToggle />
      </div>
    </SectionShell>
  );
}

function UserSection() {
  const { data: session, update: updateSession } = useSession();
  const profileQuery = useUserProfile();
  const updateProfile = useUpdateUserProfile();
  const uploadAvatar = useUploadUserAvatar();
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  const profile = profileQuery.data;
  const currentName = profile?.name || session?.user?.name || "";
  const currentAvatarPreset = avatarPresetById(
    profile?.avatarPreset || session?.user?.avatarPreset
  ).id;
  const currentAvatarUrl = profile?.avatarUrl || session?.user?.image || null;
  const email = profile?.email || session?.user?.email || "";

  const [name, setName] = useState(currentName);
  const [selectedAvatarFile, setSelectedAvatarFile] = useState<File | null>(null);
  const [accountSaved, setAccountSaved] = useState(false);
  const [avatarSaved, setAvatarSaved] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  const [promptName, setPromptName] = useState("");
  const [profession, setProfession] = useState("");
  const [details, setDetails] = useState("");
  const [generating, setGenerating] = useState(false);
  const [promptSaved, setPromptSaved] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);
  const selectedAvatarTooLarge =
    selectedAvatarFile !== null &&
    selectedAvatarFile.size > MAX_AVATAR_UPLOAD_BYTES;

  async function handleSaveAccount() {
    setAccountSaved(false);
    const nextProfile = await updateProfile.mutateAsync({
      name,
    });
    await updateSession({
      user: {
        name: nextProfile.name,
        avatarPreset: nextProfile.avatarPreset,
        image: nextProfile.avatarUrl,
      },
    });
    setAccountSaved(true);
  }

  async function handleUploadAvatar() {
    if (!selectedAvatarFile) return;
    setAvatarSaved(false);
    setAvatarError(null);
    if (selectedAvatarTooLarge) {
      setAvatarError("头像不能超过 20MB");
      return;
    }
    try {
      const nextProfile = await uploadAvatar.mutateAsync(selectedAvatarFile);
      await updateSession({
        user: {
          name: nextProfile.name,
          avatarPreset: nextProfile.avatarPreset,
          image: nextProfile.avatarUrl,
        },
      });
      setSelectedAvatarFile(null);
      if (avatarInputRef.current) avatarInputRef.current.value = "";
      setAvatarSaved(true);
    } catch (error) {
      setAvatarError(error instanceof Error ? error.message : "上传失败，请重试");
    }
  }

  async function handleGeneratePrompt() {
    if (!promptName.trim() && !profession.trim() && !details.trim()) return;
    setGenerating(true);
    setPromptError(null);
    setPromptSaved(false);
    try {
      const res = await fetch("/api/user/generate-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname: promptName, profession, details }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "生成失败");
      setPromptSaved(true);
    } catch (err) {
      setPromptError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <SectionShell id="settings-panel-user" title="用户">
      <div className="space-y-4 rounded-2xl bg-[var(--color-project-control)] p-4">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
          账户信息
        </h3>

        <div className="flex items-center gap-3">
          <AvatarMark
            presetId={currentAvatarPreset}
            src={currentAvatarUrl}
            alt={`${name.trim() || email || "账户"} 的头像`}
            className="size-10 text-sm"
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-[var(--color-text-primary)]">
              {name.trim() || email || "账户"}
            </p>
            <p className="truncate text-xs text-[var(--color-text-tertiary)]">
              侧栏和账户菜单会显示这个昵称
            </p>
          </div>
        </div>

        <div>
          <label className="text-sm font-medium text-[var(--color-text-primary)]">
            昵称
          </label>
          <Input
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setAccountSaved(false);
            }}
            placeholder="你的称呼"
            maxLength={60}
            className="mt-2 h-9 rounded-xl bg-[var(--color-surface)]"
          />
        </div>

        <div>
          <p className="text-sm font-medium text-[var(--color-text-primary)]">
            上传头像
          </p>
          <div className="mt-2 space-y-2">
            <Input
              ref={avatarInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => {
                setSelectedAvatarFile(event.target.files?.[0] ?? null);
                setAvatarSaved(false);
                setAvatarError(null);
              }}
              className="h-9 rounded-xl bg-[var(--color-surface)] text-sm"
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="secondary"
                size="md"
                onClick={handleUploadAvatar}
                disabled={
                  !selectedAvatarFile ||
                  selectedAvatarTooLarge ||
                  uploadAvatar.isPending
                }
                className="rounded-xl px-4"
              >
                <Upload data-icon="inline-start" size={16} strokeWidth={1.5} />
                {uploadAvatar.isPending ? "上传中..." : "上传头像"}
              </Button>
              <span className="text-xs text-[var(--color-text-tertiary)]">
                JPG、PNG 或 WebP，最大 20MB
              </span>
            </div>
            {selectedAvatarFile && (
              <p className="truncate text-xs text-[var(--color-text-secondary)]">
                已选择 {selectedAvatarFile.name}
              </p>
            )}
            {selectedAvatarTooLarge && (
              <p className="text-xs text-[var(--color-error)]">
                头像不能超过 20MB
              </p>
            )}
            {avatarSaved && (
              <p className="text-xs text-[var(--color-success)]">头像已上传</p>
            )}
            {avatarError && (
              <p className="text-xs text-[var(--color-error)]">{avatarError}</p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-[var(--color-text-tertiary)]">邮箱</span>
          <span className="text-sm text-[var(--color-text-primary)] truncate">
            {email}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="primary"
            size="md"
            onClick={handleSaveAccount}
            disabled={profileQuery.isPending || updateProfile.isPending}
            className="rounded-xl px-4"
          >
            {updateProfile.isPending ? "保存中..." : "保存资料"}
          </Button>
          {accountSaved && (
            <span className="text-xs text-[var(--color-success)]">已保存</span>
          )}
          {updateProfile.isError && (
            <span className="text-xs text-[var(--color-error)]">
              保存失败，请重试
            </span>
          )}
        </div>
      </div>

      <Button
        variant="danger"
        size="md"
        onClick={() => signOut({ callbackUrl: "/login" })}
        className="w-fit rounded-xl px-4"
      >
        <LogOut data-icon="inline-start" size={16} strokeWidth={1.5} />
        退出登录
      </Button>

      <div className="space-y-4 rounded-2xl bg-[var(--color-project-control)] p-4">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
          AI 画像
        </h3>
        <p className="text-xs text-[var(--color-text-tertiary)]">
          AI 会根据这些信息更好地理解你的使用场景
        </p>

        <div>
          <label className="text-sm font-medium text-[var(--color-text-primary)]">
            名字
          </label>
          <Input
            value={promptName}
            onChange={(e) => setPromptName(e.target.value)}
            placeholder="你的名字"
            maxLength={60}
            className="mt-2 h-9 rounded-xl bg-[var(--color-surface)]"
          />
        </div>
        <div>
          <label className="text-sm font-medium text-[var(--color-text-primary)]">
            职业
          </label>
          <Input
            value={profession}
            onChange={(e) => setProfession(e.target.value)}
            placeholder="例如: 计算机学院本科生"
            maxLength={100}
            className="mt-2 h-9 rounded-xl bg-[var(--color-surface)]"
          />
        </div>
        <div>
          <label className="text-sm font-medium text-[var(--color-text-primary)]">
            你的详情
          </label>
          <Textarea
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            placeholder="描述你的学习目标、使用习惯等"
            maxLength={500}
            className="mt-2 h-24 rounded-xl bg-[var(--color-surface)] resize-none"
          />
        </div>
        <Button
          variant="primary"
          size="md"
          onClick={handleGeneratePrompt}
          disabled={generating}
          className="rounded-xl px-4"
        >
          {generating
            ? "生成中..."
            : promptSaved
              ? "已保存，点击重新生成"
              : "生成个人描述"}
        </Button>
        {promptSaved && (
          <p className="text-xs text-[var(--color-success)]">已保存</p>
        )}
        {promptError && (
          <p className="text-xs text-[var(--color-error)]">{promptError}</p>
        )}
      </div>
    </SectionShell>
  );
}
