"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BookStack, ChatLines, Search } from "iconoir-react";
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

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;
const ALL_FILTERS = "__all__";

const runtimeStatusOrder: TemplateRuntimeStatus[] = ["Verified", "Compatible", "Needs Review", "Unverified", "Deprecated"];

const RUNTIME_STATUS_LABELS: Record<TemplateRuntimeStatus, string> = {
  Verified: "已验证",
  Compatible: "兼容可用",
  "Needs Review": "待复核",
  Unverified: "未验证",
  Deprecated: "已停用",
};

// 可排版 = 至少一个变体已有真实运行依据（已验证 / 兼容可用），与排版向导的可提交口径一致。
const USABLE_STATUSES: ReadonlySet<TemplateRuntimeStatus> = new Set(["Verified", "Compatible"]);

const MAINTENANCE_LABELS: Record<string, string> = {
  active: "维护中",
  stale: "久未更新",
  deprecated: "已停更",
  unknown: "状态未知",
};

const SORT_OPTIONS = [
  { value: "recommendation", label: "按推荐等级" },
  { value: "verified", label: "按最近验证" },
  { value: "university", label: "按学校名称" },
] as const;
type SortKey = (typeof SORT_OPTIONS)[number]["value"];

const RECOMMENDATION_ORDER: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 };

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

function isUsableTemplate(template: TemplateRecord) {
  return (template.variants ?? []).some((variant) => USABLE_STATUSES.has(summarizeTemplateVariant(variant).runtimeStatus));
}

function timestampOf(value: string | null) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function SourceLink({ href, label }: { href: string | null | undefined; label: string }) {
  if (!href) return <span className="text-[var(--color-text-tertiary)]">未记录</span>;
  return <a href={href} target="_blank" rel="noreferrer" className="break-all text-[var(--color-accent)] hover:underline">{label}</a>;
}

export default function PaperTemplatesPage() {
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [format, setFormat] = useState("");
  const [status, setStatus] = useState("");
  const [recommendationLevel, setRecommendationLevel] = useState("");
  const [sort, setSort] = useState<SortKey>("recommendation");
  const [usableOnly, setUsableOnly] = useState(true);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(queryInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [queryInput]);

  const templatesQuery = usePaperTemplates({ query, format, status, recommendationLevel });
  const templates = useMemo(() => (templatesQuery.data ?? []) as TemplateRecord[], [templatesQuery.data]);

  const filterKey = `${query}|${format}|${status}|${recommendationLevel}|${sort}|${usableOnly}`;
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (lastFilterKey !== filterKey) {
    setLastFilterKey(filterKey);
    setVisibleCount(PAGE_SIZE);
  }

  const filtered = useMemo(() => {
    const usable = usableOnly ? templates.filter(isUsableTemplate) : templates;
    const sorted = [...usable].sort((left, right) => {
      if (sort === "university") return left.university.localeCompare(right.university, "zh-CN");
      if (sort === "verified") return timestampOf(chooseVariant(right.variants ?? [])?.summary.lastVerifiedAt ?? null) - timestampOf(chooseVariant(left.variants ?? [])?.summary.lastVerifiedAt ?? null);
      const byRecommendation = (RECOMMENDATION_ORDER[left.recommendationLevel ?? ""] ?? 9) - (RECOMMENDATION_ORDER[right.recommendationLevel ?? ""] ?? 9);
      if (byRecommendation !== 0) return byRecommendation;
      return runtimeStatusOrder.indexOf(chooseVariant(left.variants ?? [])?.summary.runtimeStatus ?? "Unverified") - runtimeStatusOrder.indexOf(chooseVariant(right.variants ?? [])?.summary.runtimeStatus ?? "Unverified");
    });
    return sorted;
  }, [templates, usableOnly, sort]);

  const visible = filtered.slice(0, visibleCount);

  return (
    <main className="h-full overflow-y-auto bg-[var(--color-bg)]">
      <div className="mx-auto max-w-7xl px-5 py-8 sm:px-8">
        <Link href="/papers" className="text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]">← 我的论文</Link>
        <div className="mt-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">模板库</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--color-text-secondary)]">这里收录国内高校论文模板的最新验证状态。「已验证」「兼容可用」的模板格式可信，可作排版参考；模板在「论文排版」中开放提交以完成全部三级验证为准，验证通过后无需额外申请。其余模板正在验证或已停更，仅供查看格式要求。</p>
          </div>
          <BookStack className="text-[var(--color-accent)]" width={28} height={28} strokeWidth={1.5} />
        </div>

        <div className="mt-7 grid gap-3 lg:grid-cols-[minmax(0,1fr)_9rem_9rem_8rem_8rem]">
          <label className="relative block">
            <span className="sr-only">搜索学校或学位层级</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]" width={16} height={16} />
            <input value={queryInput} onChange={(event) => setQueryInput(event.target.value)} placeholder="搜索学校或学位层级" aria-label="搜索学校或学位层级" className="min-h-10 w-full rounded-[var(--radius-md)] bg-[var(--color-panel)] pl-9 pr-3 text-sm text-[var(--color-text-primary)] outline-none ring-1 ring-transparent placeholder:text-[var(--color-text-tertiary)] focus:ring-[var(--color-accent)]" />
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
                <SelectItem value="active">维护中</SelectItem>
                <SelectItem value="stale">久未更新</SelectItem>
                <SelectItem value="deprecated">已停更</SelectItem>
                <SelectItem value="unknown">状态未知</SelectItem>
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
          <Select value={sort} onValueChange={(value) => setSort(value as SortKey)}>
            <SelectTrigger aria-label="排序方式" className="min-h-10 w-full bg-[var(--color-panel)] text-sm text-[var(--color-text-secondary)]">
              <SelectValue placeholder="排序方式" />
            </SelectTrigger>
            <SelectContent position="popper" align="start">
              <SelectGroup>
                <SelectLabel>排序方式</SelectLabel>
                {SORT_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-pressed={usableOnly}
            onClick={() => setUsableOnly((current) => !current)}
            className={`inline-flex min-h-8 items-center rounded-full px-3 text-xs transition-colors ${usableOnly ? "bg-[var(--color-accent-muted)] text-[var(--color-accent)]" : "bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"}`}
          >
            只看可排版模板
          </button>
          <p className="min-w-0 flex-1 text-[11px] leading-5 text-[var(--color-text-tertiary)]">
            状态说明：已验证 = 真实样例编译通过，可直接用于排版 · 兼容可用 = 维护中的 LaTeX 模板，格式可参考 · 待复核 / 未验证 = 正在验证，暂不能提交 · 已停用 = 不再维护
          </p>
        </div>

        <div className="mt-4 flex items-center justify-between gap-3 text-xs text-[var(--color-text-tertiary)]">
          <span aria-live="polite">
            {templatesQuery.isPending ? "正在读取模板库…" : templatesQuery.isError ? "模板库暂时不可用" : usableOnly ? `可排版 ${filtered.length} 条 · 库内共 ${templates.length} 条` : `当前显示 ${filtered.length} 条`}
          </span>
          <span>运行状态不等同于推荐等级</span>
        </div>

        {templatesQuery.isError ? (
          <div className="mt-5 bg-[var(--color-panel)] px-6 py-12 text-center">
            <p className="text-sm text-[var(--color-danger)]">模板库暂时不可用，请检查网络后重试。</p>
            <button
              type="button"
              onClick={() => templatesQuery.refetch()}
              disabled={templatesQuery.isRefetching}
              className="mt-4 inline-flex min-h-9 items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-panel-muted)] px-4 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] disabled:opacity-60"
            >
              {templatesQuery.isRefetching ? "正在重试…" : "重试"}
            </button>
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            {visible.map((template) => {
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
                      <span className={`rounded-full px-2 py-1 text-[11px] ${statusClass(summary?.runtimeStatus ?? "Unverified")}`}>{RUNTIME_STATUS_LABELS[summary?.runtimeStatus ?? "Unverified"]}</span>
                      <span className="rounded-full bg-[var(--color-surface-hover)] px-2 py-1 text-[11px] text-[var(--color-text-tertiary)]">{MAINTENANCE_LABELS[(template.status ?? "").toLowerCase()] ?? "状态未知"}</span>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 border-t border-[var(--color-separator)] pt-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
                    <div><p className="text-[var(--color-text-tertiary)]">来源</p><div className="mt-1"><SourceLink href={sourceHref} label={template.repositoryUrl ? "模板仓库" : "学校规范"} /></div></div>
                    <div><p className="text-[var(--color-text-tertiary)]">最近验证</p><p className="mt-1 text-[var(--color-text-secondary)]">{formatDate(summary?.lastVerifiedAt ?? null)}</p></div>
                    <div><p className="text-[var(--color-text-tertiary)]">样例 PDF</p><div className="mt-1">{selected?.summary.samplePdf ? <a href={`/api/papers/templates/${selected.variant.id}/sample`} target="_blank" rel="noreferrer" className="text-[var(--color-accent)] hover:underline">查看实际样例</a> : <span className="text-[var(--color-text-tertiary)]">尚未生成</span>}</div></div>
                    <div><p className="text-[var(--color-text-tertiary)]">状态说明</p><p className="mt-1 truncate text-[var(--color-text-secondary)]" title={summary?.errorCode ?? undefined}>{summary?.errorCode ?? (summary?.runtimeStatus === "Verified" ? "PDF 产物已校验" : "等待验证")}</p></div>
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
                      {summary?.runtimeStatus === "Needs Review" && summary.errorCode ? <p className="mt-3 rounded-[var(--radius-md)] bg-[var(--color-warning-muted)] px-3 py-2 text-[var(--color-warning)]">当前验证未通过：{summary.errorCode}。模板仍保留在库中，可在验证环境恢复后重试。</p> : null}
                    </CollapsibleContent>
                  </Collapsible>
                </article>
              );
            })}

            {!templatesQuery.isPending && filtered.length === 0 && usableOnly ? (
              <div className="bg-[var(--color-panel)] px-6 py-12 text-center">
                <p className="text-sm font-medium text-[var(--color-text-primary)]">暂时没有可直接排版的模板</p>
                <p className="mx-auto mt-2 max-w-xl text-xs leading-5 text-[var(--color-text-secondary)]">
                  学校模板需要通过「固定快照、隔离编译、真实样例排版」验证后才能开放提交，当前收录的模板都还在验证队列中。你可以先去聊天，让 AI 参考学校的格式要求帮你排版；也可以查看全部模板了解验证进度。
                </p>
                <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                  <Link href="/chat" className="inline-flex min-h-9 items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-accent)] px-4 text-sm font-medium text-white transition-opacity hover:opacity-90"><ChatLines width={16} height={16} />去聊天让 AI 帮忙排版</Link>
                  <button
                    type="button"
                    onClick={() => setUsableOnly(false)}
                    className="inline-flex min-h-9 items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-panel-muted)] px-4 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)]"
                  >
                    查看全部 {templates.length} 条模板
                  </button>
                </div>
              </div>
            ) : null}

            {!templatesQuery.isPending && !templatesQuery.isError && filtered.length === 0 && !usableOnly ? <div className="bg-[var(--color-panel)] px-5 py-12 text-center text-sm text-[var(--color-text-tertiary)]">没有匹配的模板记录。</div> : null}

            {filtered.length > visibleCount ? (
              <div className="pt-1 text-center">
                <button
                  type="button"
                  onClick={() => setVisibleCount((current) => current + PAGE_SIZE)}
                  className="inline-flex min-h-9 items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-panel)] px-4 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)]"
                >
                  加载更多（已显示 {visible.length} / {filtered.length} 条）
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </main>
  );
}
