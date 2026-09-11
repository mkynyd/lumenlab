"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseLoginIdentifier, type IdentityType } from "@/lib/auth/identifier";

type IdentityStatus = { type: IdentityType; maskedValue: string; verified: boolean };
export function IdentitySettings() {
  const [identities, setIdentities] = useState<IdentityStatus[] | null>(null);
  const [binding, setBinding] = useState<IdentityType | null>(null);
  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [resendLeft, setResendLeft] = useState(0);
  const [message, setMessage] = useState("");

  async function load() {
    const response = await fetch("/api/user/identities", { cache: "no-store" });
    if (!response.ok) throw new Error("无法读取登录方式，请稍后重试");
    const data = await response.json();
    setIdentities(data.identities);
  }
  useEffect(() => { load().catch(() => setMessage("无法读取登录方式，请稍后重试")); }, []);
  useEffect(() => {
    if (resendLeft <= 0) return;
    const timer = window.setTimeout(() => setResendLeft((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [resendLeft]);

  async function post(action: string, data: Record<string, unknown>) {
    const response = await fetch(`/api/user/identities/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    const body = await response.json();
    if (!response.ok) {
      if (response.status === 429) setResendLeft(body.resendAfter ?? 60);
      throw new Error(typeof body.error === "string" ? body.error : "验证失败，请重新获取验证码");
    }
    return body;
  }
  async function send() {
    const parsed = parseLoginIdentifier(identifier);
    if (!parsed || parsed.type !== binding) { setMessage("请输入正确的邮箱或大陆手机号"); return; }
    setPending(true); setMessage("");
    try {
      const data = await post("send", { identifier: parsed.providerAccountId });
      setSent(true); setCode(""); setResendLeft(data.resendAfter ?? 60);
    } catch (error) { setMessage(error instanceof Error ? error.message : "发送失败"); }
    finally { setPending(false); }
  }
  async function bind() {
    setPending(true); setMessage("");
    try {
      const proof = await post("code", { identifier, code });
      await post("bind", { identifier, ticket: proof.ticket });
      await load(); setBinding(null); setIdentifier(""); setCode(""); setSent(false);
      setMessage("绑定成功，可使用同一个账户密码登录");
    } catch (error) { setMessage(error instanceof Error ? error.message : "绑定失败"); }
    finally { setPending(false); }
  }
  return <section className="mb-7 space-y-4" aria-labelledby="identity-settings-heading">
    <div>
      <h3 id="identity-settings-heading" className="text-sm font-medium">登录方式</h3>
      <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">邮箱和手机号共用账户密码。验证码用于注册与绑定。</p>
    </div>
    {(["email", "phone"] as const).map((type) => {
      const identity = identities?.find((value) => value.type === type);
      const label = type === "email" ? "邮箱" : "手机号";
      return <div key={type} className="flex min-w-0 items-center justify-between gap-3 py-2">
        <div className="min-w-0 text-sm"><span>{label}</span><p className="mt-1 break-all text-xs text-[var(--color-text-secondary)]">{identity ? `${identity.maskedValue} · ${identity.verified ? "已验证" : "未验证"}` : identities ? "未绑定" : "读取中…"}</p></div>
        {!identity && identities && <Button size="sm" variant="ghost" disabled={pending} onClick={() => { setBinding(type); setIdentifier(""); setCode(""); setSent(false); setMessage(""); }}>绑定{label}</Button>}
      </div>;
    })}
    {binding && <div className="space-y-3 rounded-md bg-[var(--color-panel)] p-4">
      <label className="block text-sm" htmlFor="bind-identifier">待绑定{binding === "email" ? "邮箱" : "手机号"}</label>
      <Input id="bind-identifier" type={binding === "email" ? "email" : "tel"} autoComplete={binding === "email" ? "email" : "tel"} value={identifier} disabled={pending || sent} onChange={(event) => setIdentifier(event.target.value)} />
      {sent && <><label className="block text-sm" htmlFor="bind-code">验证码</label><Input id="bind-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} /><p className="text-xs text-[var(--color-text-tertiary)]">{binding === "phone" ? "短信验证码 5 分钟内有效" : "邮箱验证码 15 分钟内有效"}</p></>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" disabled={pending || (sent && resendLeft > 0)} onClick={send}>{sent ? (resendLeft > 0 ? `重新发送（${resendLeft}s）` : "重新发送") : "发送验证码"}</Button>
        {sent && <Button size="sm" disabled={pending || !/^\d{6}$/.test(code)} onClick={bind}>{pending ? "验证中…" : "验证并绑定"}</Button>}
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => { setBinding(null); setSent(false); }}>取消</Button>
      </div>
    </div>}
    {message && <p role="status" className="text-sm text-[var(--color-text-secondary)]">{message}</p>}
    {identities === null && message && <Button size="sm" variant="ghost" onClick={() => { setMessage(""); load().catch(() => setMessage("无法读取登录方式，请稍后重试")); }}>重试</Button>}
  </section>;
}
