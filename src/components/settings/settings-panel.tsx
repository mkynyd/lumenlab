"use client";

import { signOut, useSession } from "next-auth/react";
import { useState } from "react";
import {
  Database,
  KeyRound,
  LogOut,
  Palette,
  RefreshCw,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useCacheMetrics } from "@/lib/hooks/use-cache-metrics";
import { cn } from "@/lib/utils";

type TabId = "alpha" | "tokens" | "profile" | "appearance" | "account";

function formatTokenCount(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

export function SettingsPanel() {
  const [tab, setTab] = useState<TabId>("alpha");

  const tabs: Array<{ id: TabId; label: string; icon: typeof KeyRound }> = [
    { id: "alpha", label: "服务访问", icon: KeyRound },
    { id: "tokens", label: "用量统计", icon: Database },
    { id: "profile", label: "关于你", icon: UserRound },
    { id: "appearance", label: "外观", icon: Palette },
    { id: "account", label: "账户", icon: LogOut },
  ];

  return (
    <div className="flex h-[520px]">
      {/* Left sidebar */}
      <nav className="w-40 shrink-0 border-r border-[var(--color-panel-muted)] bg-[var(--color-panel)] py-3 flex flex-col">
        {tabs.map((item) => (
          <button
            key={item.id}
            onClick={() => setTab(item.id)}
            className={cn(
              "flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors duration-150 text-left w-full",
              tab === item.id
                ? "bg-[var(--color-accent-muted)] text-[var(--color-accent)] font-medium"
                : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-interaction-hover)]"
            )}
          >
            <item.icon size={16} strokeWidth={1.5} />
            {item.label}
          </button>
        ))}
      </nav>

      {/* Right content */}
      <ScrollArea className="flex-1 min-w-0">
        <div className="px-6 py-4">
          {tab === "alpha" && <AlphaSection />}
          {tab === "tokens" && <TokensSection />}
          {tab === "profile" && <ProfileSection />}
          {tab === "appearance" && <AppearanceSection />}
          {tab === "account" && <AccountSection />}
        </div>
      </ScrollArea>
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
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">服务访问</h2>

      <div className="rounded-[var(--radius-md)] bg-[var(--color-surface)] p-3">
        <div className="flex items-start gap-3">
          <ShieldCheck size={16} className="mt-0.5 shrink-0 text-[var(--color-success)]" />
          <div className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
            API Key 由管理员统一配置。账户通过注册码绑定 Alpha 测试密钥组，无需自行填写。
          </div>
        </div>
      </div>

      <div className="rounded-[var(--radius-md)] bg-[var(--color-surface)] p-3 space-y-2">
        <p className="text-xs font-medium text-[var(--color-text-primary)]">更换注册码</p>
        <div className="flex gap-2">
          <Input
            type="text"
            value={switchCodeValue}
            onChange={(e) => setSwitchCodeValue(e.target.value)}
            placeholder="XXXX-XXXX-XXXX-XXXX"
            className="flex-1 font-mono text-sm bg-[var(--color-project-control)]"
          />
          <Button variant="primary" size="sm" disabled={switchPending || !switchCodeValue.trim()} onClick={handleSwitchCode}>
            {switchPending ? "验证中..." : "更换"}
          </Button>
        </div>
        {switchMessage && (
          <p className={cn("text-xs", switchError ? "text-[var(--color-error)]" : "text-[var(--color-success)]")}>
            {switchMessage}
          </p>
        )}
      </div>
    </div>
  );
}

function TokensSection() {
  const cacheMetrics = useCacheMetrics(7);

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">用量统计</h2>
      <p className="text-xs text-[var(--color-text-secondary)]">近 7 天 Token 使用情况</p>

      {cacheMetrics.isPending ? (
        <Skeleton className="h-24 rounded-[var(--radius-md)]" />
      ) : cacheMetrics.data ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-[var(--radius-md)] bg-[var(--color-surface)] p-3">
            <p className="text-xs text-[var(--color-text-tertiary)]">近 7 天总量</p>
            <p className="mt-1 text-xl font-semibold text-[var(--color-text-primary)]">{formatTokenCount(cacheMetrics.data.tokenUsage.totalTokens)}</p>
            <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">今日 {formatTokenCount(cacheMetrics.data.tokenUsage.todayTokens)}</p>
          </div>
          <div className="rounded-[var(--radius-md)] bg-[var(--color-surface)] p-3">
            {(["deepseek", "minimax"] as const).map((provider) => (
              <div key={provider} className="flex justify-between py-1 text-sm">
                <span className="text-[var(--color-text-secondary)]">{provider === "deepseek" ? "DeepSeek" : "MiniMax"}</span>
                <span className="font-mono text-[var(--color-text-primary)]">
                  {cacheMetrics.data.tokenUsage.providers[provider].requestCount > 0
                    ? formatTokenCount(cacheMetrics.data.tokenUsage.providers[provider].totalTokens)
                    : "--"}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-sm text-[var(--color-error)]">加载失败</p>
      )}
    </div>
  );
}

function ProfileSection() {
  const [nickname, setNickname] = useState("");
  const [profession, setProfession] = useState("");
  const [details, setDetails] = useState("");
  const [generating, setGenerating] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    if (!nickname.trim() && !profession.trim() && !details.trim()) return;
    setGenerating(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/user/generate-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname, profession, details }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "生成失败");
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">关于你</h2>
      <p className="text-xs text-[var(--color-text-secondary)]">AI 会根据这些信息更好地理解你的使用场景</p>

      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium text-[var(--color-text-secondary)]">昵称</label>
          <Input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="你的称呼" maxLength={60} className="mt-1 bg-[var(--color-project-control)]" />
        </div>
        <div>
          <label className="text-xs font-medium text-[var(--color-text-secondary)]">职业 / 专业</label>
          <Input value={profession} onChange={(e) => setProfession(e.target.value)} placeholder="例如：临床医学大三学生" maxLength={100} className="mt-1 bg-[var(--color-project-control)]" />
        </div>
        <div>
          <label className="text-xs font-medium text-[var(--color-text-secondary)]">你的详情</label>
          <Textarea value={details} onChange={(e) => setDetails(e.target.value)} placeholder="描述你的学习目标、使用习惯等" maxLength={500} className="mt-1 h-20 resize-none bg-[var(--color-project-control)]" />
        </div>
        <Button variant="primary" size="sm" onClick={handleGenerate} disabled={generating}>
          {generating ? "生成中..." : saved ? "已保存，点击重新生成" : "生成个人描述"}
        </Button>
        {saved && <p className="text-xs text-[var(--color-success)]">已保存</p>}
        {error && <p className="text-xs text-[var(--color-error)]">{error}</p>}
      </div>
    </div>
  );
}

function AppearanceSection() {
  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">外观</h2>
      <div className="flex items-center justify-between rounded-[var(--radius-md)] bg-[var(--color-surface)] p-3">
        <span className="text-sm text-[var(--color-text-secondary)]">主题</span>
        <ThemeToggle />
      </div>
    </div>
  );
}

function AccountSection() {
  const { data: session } = useSession();

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">账户</h2>
      <div className="rounded-[var(--radius-md)] bg-[var(--color-surface)] p-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-[var(--color-text-tertiary)]">邮箱</span>
          <span className="text-sm text-[var(--color-text-primary)] truncate">{session?.user?.email}</span>
        </div>
      </div>
      <Button variant="danger" size="sm" onClick={() => signOut({ callbackUrl: "/login" })} className="w-fit">
        退出登录
      </Button>
    </div>
  );
}
