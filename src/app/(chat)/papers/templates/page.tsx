"use client";

import { useState } from "react";
import Link from "next/link";
import { BookStack, Search } from "iconoir-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePaperTemplates } from "@/lib/hooks/use-papers";
import { summarizeTemplateVariant, type TemplateRuntimeStatus } from "@/lib/paper/template-registry";

interface TemplateVariantRecord {
  id: string;
  variantKey: string;
  status?: string | null;
  adapterId?: string | null;
  validation?: unknown;
  sample?: unknown;
}

interface TemplateRecord {
  id: string;
  externalId: string;
  university: string;
  degreeType?: string | null;
  year?: string | null;
  format: string;
  sourceType?: string | null;
  officialSpecUrl?: string | null;
  repositoryUrl?: string | null;
  engine?: string | null;
  bibliography?: string | null;
  license?: string | null;
  entryFile?: string | null;
  documentClass?: string | null;
  sourceVersion?: string | null;
  status?: string | null;
  recommendationLevel?: string | null;
  variants?: TemplateVariantRecord[];
}

const runtimeStatusOrder: TemplateRuntimeStatus[] = ["Verified", "Compatible", "Needs Review", "Unverified", "Deprecated"];
const ALL_FILTERS = "__all__";

function formatDate(value: string | null) {
  if (!value) return "尚未验证";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "验证时间未知" : new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(date);
}

function statusClass(status: TemplateRuntimeStatus) {
  if (status === "Verified") return "bg-[var(--color-success-muted)] text-[var(--color-success)]";
  if (status === "Compatible") return "bg-[var(--color-info-muted)] text-[var(--color-info)]";
  if (status === "Needs Review") return "bg-[var(--color-warning-muted)] text-[var(--color-warning)]";
  return "bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)]";
}

function chooseVariant(variants: TemplateVariantRecord[]) {
  return variants
    .map((variant) => ({ variant, summary: summarizeTemplateVariant(variant) }))
    .sort((left, right) => runtimeStatusOrder.indexOf(left.summary.runtimeStatus) - runtimeStatusOrder.indexOf(right.summary.runtimeStatus))[0] ?? null;
}

function SourceLink({ href, label }: { href: string | null | undefined; label: string }) {
  if (!href) return <span className="text-[var(--color-text-tertiary)]">未记录</span>;
  return <a href={href} target="_blank" rel="noreferrer" className="break-all text-[var(--color-accent)] hover:underline">{label}</a>;
}

export default function PaperTemplatesPage() {
  const [query, setQuery] = useState("");
  const [format, setFormat] = useState("");
  const [status, setStatus] = useState("");
  const [recommendationLevel, setRecommendationLevel] = useState("");
  const templatesQuery = usePaperTemplates({ query, format, status, recommendationLevel });
  const templates = (templatesQuery.data ?? []) as TemplateRecord[];

  return (
    <main className="h-full overflow-y-auto bg-[var(--color-bg)]">
      <div className="mx-auto max-w-7xl px-5 py-8 sm:px-8">
        <Link href="/papers" className="text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]">← 我的论文</Link>
        <div className="mt-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">模板库</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--color-text-secondary)]">完整展示真实 Registry 的学校、学位、年份、来源与维护状态；运行验证状态与推荐等级保持独立。</p>
          </div>
          <BookStack className="text-[var(--color-accent)]" width={28} height={28} strokeWidth={1.5} />
        </div>

        <div className="mt-7 grid gap-3 lg:grid-cols-[minmax(0,1fr)_10rem_10rem_9rem]">
          <label className="relative block">
            <span className="sr-only">搜索学校或学位层级</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]" width={16} height={16} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索学校或学位层级" aria-label="搜索学校或学位层级" className="min-h-10 w-full rounded-[var(--radius-md)] bg-[var(--color-panel)] pl-9 pr-3 text-sm text-[var(--color-text-primary)] outline-none ring-1 ring-transparent placeholder:text-[var(--color-text-tertiary)] focus:ring-[var(--color-accent)]" />
          </label>
          <Select value={format || ALL_FILTERS} onValueChange={(value) => setFormat(value === ALL_FILTERS ? "" : value)}>
            <SelectTrigger aria-label="按格式筛选" className="min-h-10 w-full bg-[var(--color-panel)] text-sm text-[var(--color-text-secondary)]">
              <SelectValue placeholder="全部格式" />
            </SelectTrigger>
            <SelectContent position="popper" align="start">
              <SelectGroup>
                <SelectLabel>格式</SelectLabel>
                <SelectItem value={ALL_FILTERS}>全部格式</SelectItem>
                <SelectItem value="latex">LaTeX</SelectItem>
                <SelectItem value="overleaf">Overleaf</SelectItem>
                <SelectItem value="typst">Typst</SelectItem>
                <SelectItem value="word">Word</SelectItem>
                <SelectItem value="markdown">Markdown</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <Select value={status || ALL_FILTERS} onValueChange={(value) => setStatus(value === ALL_FILTERS ? "" : value)}>
            <SelectTrigger aria-label="按维护状态筛选" className="min-h-10 w-full bg-[var(--color-panel)] text-sm text-[var(--color-text-secondary)]">
              <SelectValue placeholder="全部维护状态" />
            </SelectTrigger>
            <SelectContent position="popper" align="start">
              <SelectGroup>
                <SelectLabel>维护状态</SelectLabel>
                <SelectItem value={ALL_FILTERS}>全部维护状态</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="stale">Stale</SelectItem>
                <SelectItem value="deprecated">Deprecated</SelectItem>
                <SelectItem value="unknown">Unknown</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <Select value={recommendationLevel || ALL_FILTERS} onValueChange={(value) => setRecommendationLevel(value === ALL_FILTERS ? "" : value)}>
            <SelectTrigger aria-label="按推荐等级筛选" className="min-h-10 w-full bg-[var(--color-panel)] text-sm text-[var(--color-text-secondary)]">
              <SelectValue placeholder="A-D 全部" />
            </SelectTrigger>
            <SelectContent position="popper" align="start">
              <SelectGroup>
                <SelectLabel>推荐等级</SelectLabel>
                <SelectItem value={ALL_FILTERS}>A-D 全部</SelectItem>
                <SelectItem value="A">A · 优先</SelectItem>
                <SelectItem value="B">B · 可用</SelectItem>
                <SelectItem value="C">C · 待评估</SelectItem>
                <SelectItem value="D">D · 资料</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        <div className="mt-5 flex items-center justify-between gap-3 text-xs text-[var(--color-text-tertiary)]">
          <span>{templatesQuery.isPending ? "正在读取 Registry…" : templatesQuery.isError ? "Registry 暂时不可用" : `当前显示 ${templates.length} 条`}</span>
          <span>运行状态不等同于推荐等级</span>
        </div>

        <div className="mt-3 space-y-3">
          {templates.map((template) => {
            const selected = chooseVariant(template.variants ?? []);
            const summary = selected?.summary;
            const sourceHref = template.repositoryUrl ?? template.officialSpecUrl;
            return (
              <article key={template.externalId ?? template.id} className="bg-[var(--color-panel)] px-4 py-4 sm:px-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">{template.university}</h2>
                      <span className="rounded-full bg-[var(--color-surface-hover)] px-2 py-0.5 text-[11px] text-[var(--color-text-secondary)]">{template.format}</span>
                      <span className="rounded-full bg-[var(--color-accent-muted)] px-2 py-0.5 text-[11px] text-[var(--color-accent)]">推荐 {template.recommendationLevel ?? "-"}</span>
                    </div>
                    <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{template.degreeType ?? "未标明学位"} · {template.year ?? "年份未知"} · {template.sourceType ?? "来源类型未知"}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className={`rounded-full px-2 py-1 text-[11px] ${statusClass(summary?.runtimeStatus ?? "Unverified")}`}>{summary?.runtimeStatus ?? "Unverified"}</span>
                    <span className="rounded-full bg-[var(--color-surface-hover)] px-2 py-1 text-[11px] text-[var(--color-text-tertiary)]">维护 {template.status ?? "Unverified"}</span>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 border-t border-[var(--color-separator)] pt-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
                  <div><p className="text-[var(--color-text-tertiary)]">来源</p><div className="mt-1"><SourceLink href={sourceHref} label={template.repositoryUrl ? "打开仓库" : "打开官方规范"} /></div></div>
                  <div><p className="text-[var(--color-text-tertiary)]">最近验证</p><p className="mt-1 text-[var(--color-text-secondary)]">{formatDate(summary?.lastVerifiedAt ?? null)}</p></div>
                  <div><p className="text-[var(--color-text-tertiary)]">Sample PDF</p><div className="mt-1">{selected?.summary.samplePdf ? <a href={`/api/papers/templates/${selected.variant.id}/sample`} target="_blank" rel="noreferrer" className="text-[var(--color-accent)] hover:underline">查看实际样例</a> : <span className="text-[var(--color-text-tertiary)]">尚未生成</span>}</div></div>
                  <div><p className="text-[var(--color-text-tertiary)]">验证说明</p><p className="mt-1 truncate text-[var(--color-text-secondary)]" title={summary?.errorCode ?? undefined}>{summary?.errorCode ?? (summary?.runtimeStatus === "Verified" ? "PDF 产物已校验" : "等待验证")}</p></div>
                </div>

                <Collapsible className="mt-3 border-t border-[var(--color-separator)] pt-3 text-xs text-[var(--color-text-secondary)]">
                  <CollapsibleTrigger asChild>
                    <button type="button" className="cursor-pointer text-left text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]">
                      高级信息{(template.variants?.length ?? 0) > 1 ? ` · ${template.variants?.length} 个 Variant` : ""}
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="mt-3 grid gap-x-5 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
                    <p>Engine：{template.engine ?? "-"}</p>
                    <p>Bibliography：{template.bibliography ?? "-"}</p>
                    <p>Entry：{template.entryFile ?? "-"}</p>
                    <p>Document class：{template.documentClass ?? "-"}</p>
                    <p>版本/Commit：{template.sourceVersion ?? "-"}</p>
                    <p>License：{template.license ?? "-"}</p>
                    <p className="sm:col-span-2">Repository：<SourceLink href={template.repositoryUrl} label={template.repositoryUrl ?? "未记录"} /></p>
                    </div>
                    {summary?.runtimeStatus === "Needs Review" && summary.errorCode ? <p className="mt-3 rounded-[var(--radius-md)] bg-[var(--color-warning-muted)] px-3 py-2 text-[var(--color-warning)]">当前验证未通过：{summary.errorCode}。模板仍保留在 Registry 中，可在验证环境恢复后重试。</p> : null}
                  </CollapsibleContent>
                </Collapsible>
              </article>
            );
          })}
          {!templatesQuery.isPending && !templatesQuery.isError && templates.length === 0 ? <div className="bg-[var(--color-panel)] px-5 py-12 text-center text-sm text-[var(--color-text-tertiary)]">没有匹配的模板记录。</div> : null}
        </div>
      </div>
    </main>
  );
}
