"use client";

import { useState } from "react";
import Link from "next/link";
import { Check } from "iconoir-react";
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
      setMessage("请选择已经固定 upstream snapshot 的可执行模板");
      return;
    }
    setMessage("");
    try {
      await bindTemplate.mutateAsync({ templateVariantId: option.variant.id, lockedVersion: option.lockedVersion });
      setMessage(`已锁定 ${option.template.university} · ${option.variant.variantKey}`);
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  return (
    <section className="mt-5 bg-[var(--color-panel)] px-5 py-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">排版模板</h2>
          <p className="mt-1 text-xs leading-5 text-[var(--color-text-tertiary)]">只绑定已经固定版本的可执行 LaTeX/Overleaf 模板。绑定会创建新的 Template Binding Version，不改变正文 Document。</p>
        </div>
        <Link href="/papers/templates" className="text-xs text-[var(--color-accent)] hover:underline">浏览完整模板库</Link>
      </div>
      {currentBinding ? <p className="mt-3 rounded-[var(--radius-md)] bg-[var(--color-accent-muted)] px-3 py-2 text-xs text-[var(--color-text-secondary)]">当前锁定：{currentBinding.templateVariant?.registryEntry?.university ?? "模板"} · {currentBinding.templateVariant?.variantKey ?? currentBinding.templateVariantId} · {currentBinding.lockedVersion}</p> : <p className="mt-3 text-xs text-[var(--color-text-tertiary)]">当前使用通用学术模板，选择并锁定学校模板后再编译。</p>}
      <form className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto]" onSubmit={submit}>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索学校" aria-label="搜索模板学校" className="min-h-9 rounded-[var(--radius-md)] bg-[var(--color-bg)] px-3 text-xs text-[var(--color-text-primary)] outline-none ring-1 ring-transparent placeholder:text-[var(--color-text-tertiary)] focus:ring-[var(--color-accent)]" />
        <Select value={selectedId || NO_TEMPLATE} onValueChange={(value) => setSelectedId(value === NO_TEMPLATE ? "" : value)}>
          <SelectTrigger aria-label="选择可执行论文模板" className="min-h-9 min-w-0 bg-[var(--color-bg)] text-xs text-[var(--color-text-secondary)]">
            <SelectValue placeholder={query.trim().length < 2 ? "先输入至少两个字符搜索学校" : templatesQuery.isPending ? "正在读取模板…" : options.length > 0 ? "选择学校模板" : "没有已固定的可执行模板"} />
          </SelectTrigger>
          <SelectContent position="popper" align="start">
            <SelectGroup>
              <SelectLabel>可执行模板</SelectLabel>
              <SelectItem value={NO_TEMPLATE}>{query.trim().length < 2 ? "先输入至少两个字符搜索学校" : templatesQuery.isPending ? "正在读取模板…" : options.length > 0 ? "选择学校模板" : "没有已固定的可执行模板"}</SelectItem>
              {options.map(({ template, variant, lockedVersion }) => <SelectItem key={variant.id} value={variant.id}>{template.university} · {template.degreeType ?? "学位未知"} · {template.year ?? "年份未知"} · {lockedVersion}</SelectItem>)}
            </SelectGroup>
          </SelectContent>
        </Select>
        <button type="submit" disabled={bindTemplate.isPending || options.length === 0} className="inline-flex min-h-9 items-center justify-center gap-1 rounded-[var(--radius-md)] bg-[var(--color-accent)] px-3 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"><Check width={14} height={14} />锁定模板</button>
      </form>
      {message ? <p className="mt-3 text-xs text-[var(--color-text-secondary)]">{message}</p> : null}
    </section>
  );
}
