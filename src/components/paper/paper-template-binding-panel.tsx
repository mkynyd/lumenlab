"use client";

import { useState } from "react";
import Link from "next/link";
import { Check } from "iconoir-react";
import { fetchJson } from "@/lib/api/client";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useBindPaperTemplate, usePaperTemplates } from "@/lib/hooks/use-papers";

interface TemplateVariantOption {
  id: string;
  variantKey: string;
  pinnedUpstreamSnapshot?: unknown;
}

interface TemplateRecord {
  externalId: string;
  university: string;
  degreeType?: string | null;
  year?: string | null;
  format: string;
  variants?: TemplateVariantOption[];
}

interface CurrentBinding {
  templateVariantId: string;
  lockedVersion: string;
  templateVariant?: { variantKey?: string; registryEntry?: { university?: string; degreeType?: string | null; year?: string | null } } | null;
}

const NO_TEMPLATE = "__no_template__";

function snapshotLock(variant: TemplateVariantOption): string | null {
  if (!variant.pinnedUpstreamSnapshot || typeof variant.pinnedUpstreamSnapshot !== "object" || Array.isArray(variant.pinnedUpstreamSnapshot)) return null;
  const snapshot = variant.pinnedUpstreamSnapshot as Record<string, unknown>;
  if (snapshot.materialized !== true) return null;
  return typeof snapshot.snapshotId === "string" ? snapshot.snapshotId : typeof snapshot.commitOrVersion === "string" ? snapshot.commitOrVersion : null;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "模板绑定失败，请稍后重试";
}

export function PaperTemplateBindingPanel({ workspaceId, documentId, currentBinding }: { workspaceId: string; documentId: string; currentBinding?: CurrentBinding | null }) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(currentBinding?.templateVariantId ?? "");
  const [message, setMessage] = useState("");
  const templatesQuery = usePaperTemplates({ query, limit: 100 }, { enabled: query.trim().length >= 2 });
  const bindTemplate = useBindPaperTemplate(workspaceId, documentId);
  const options = ((templatesQuery.data ?? []) as TemplateRecord[])
    .filter((template) => ["latex", "overleaf"].includes(template.format.toLowerCase()))
    .flatMap((template) => (template.variants ?? []).map((variant) => ({ template, variant, lockedVersion: snapshotLock(variant) })))
    .filter((item) => item.lockedVersion);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const option = options.find((item) => item.variant.id === selectedId);
    if (!option?.lockedVersion) {
      setMessage("请选择学校模板");
      return;
    }
    setMessage("");
    try {
      await bindTemplate.mutateAsync({ templateVariantId: option.variant.id, lockedVersion: option.lockedVersion });
      setMessage(`已锁定 ${option.template.university} · ${option.variant.variantKey}`);
      try {
        await fetchJson(`/api/papers/documents/${documentId}/compile`, { method: "POST" });
      } catch {
        setMessage("模板已应用，请点击编译 PDF 更新预览。");
      }
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  return (
    <section className="rounded-[var(--radius-md)] bg-[var(--color-panel)] px-5 py-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">1 · 选择排版模板</h2>
        </div>
        <Link href="/papers/templates" className="text-xs text-[var(--color-accent)] hover:underline">浏览完整模板库</Link>
      </div>
      {currentBinding ? <p className="mt-3 rounded-[var(--radius-md)] bg-[var(--color-accent-muted)] px-3 py-2 text-xs text-[var(--color-text-secondary)]">已锁定：{currentBinding.templateVariant?.registryEntry?.university ?? "模板"} · {currentBinding.templateVariant?.variantKey ?? currentBinding.templateVariantId}</p> : <p className="mt-3 text-xs text-[var(--color-text-tertiary)]">当前：通用学术模板</p>}
      <form className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto]" onSubmit={submit}>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索学校" aria-label="搜索模板学校" className="min-h-9 rounded-[var(--radius-md)] bg-[var(--color-panel-muted)] px-3 text-xs text-[var(--color-text-primary)] outline-none ring-1 ring-[var(--color-border-light)] placeholder:text-[var(--color-text-tertiary)] focus:bg-[var(--color-bg)] focus:ring-[var(--color-accent)]" />
        <Select value={selectedId || NO_TEMPLATE} onValueChange={(value) => setSelectedId(value === NO_TEMPLATE ? "" : value)}>
          <SelectTrigger aria-label="选择学校论文模板" className="min-h-9 min-w-0 bg-[var(--color-panel-muted)] text-xs text-[var(--color-text-secondary)]">
            <SelectValue placeholder={query.trim().length < 2 ? "先输入至少两个字符搜索学校" : templatesQuery.isPending ? "正在读取模板…" : options.length > 0 ? "选择学校模板" : "该学校暂未准备好可用模板"} />
          </SelectTrigger>
          <SelectContent position="popper" align="start">
            <SelectGroup>
              <SelectLabel>学校模板</SelectLabel>
              <SelectItem value={NO_TEMPLATE}>{query.trim().length < 2 ? "先输入至少两个字符搜索学校" : templatesQuery.isPending ? "正在读取模板…" : options.length > 0 ? "选择学校模板" : "该学校暂未准备好可用模板"}</SelectItem>
              {options.map(({ template, variant }) => <SelectItem key={variant.id} value={variant.id}>{template.university} · {template.degreeType ?? "学位未知"} · {template.year ?? "年份未知"} · {variant.variantKey}</SelectItem>)}
            </SelectGroup>
          </SelectContent>
        </Select>
        <button type="submit" disabled={bindTemplate.isPending || options.length === 0} className="inline-flex min-h-9 items-center justify-center gap-1 rounded-[var(--radius-md)] bg-[var(--color-accent)] px-3 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"><Check width={14} height={14} />使用此模板</button>
      </form>
      {message ? <p className="mt-3 text-xs text-[var(--color-text-secondary)]">{message}</p> : null}
    </section>
  );
}
