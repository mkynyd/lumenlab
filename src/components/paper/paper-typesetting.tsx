"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BookStack, CheckCircle, LayoutLeft, NavArrowRight, Upload } from "iconoir-react";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/api/client";
import { useFormattingTemplates, useSubmitFormatting, type FormattingTemplateRecord, type FormattingTemplateVariant } from "@/lib/hooks/use-formatting";

const METADATA_FIELDS: Array<{ key: string; label: string; placeholder: string; required?: boolean; wide?: boolean }> = [
  { key: "title", label: "论文题目", placeholder: "例如：面向课程资料的检索增强研究", required: true, wide: true },
  { key: "authors", label: "作者（多人用顿号分隔）", placeholder: "例如：张三、李四", required: true, wide: true },
  { key: "institution", label: "学校名称", placeholder: "例如：重庆大学" },
  { key: "department", label: "学院", placeholder: "例如：计算机学院" },
  { key: "major", label: "专业", placeholder: "例如：计算机科学与技术" },
  { key: "studentId", label: "学号", placeholder: "例如：20210001" },
  { key: "supervisor", label: "指导教师", placeholder: "例如：王教授" },
  { key: "degreeType", label: "学位类型", placeholder: "例如：本科 / 硕士 / 博士" },
  { key: "date", label: "日期", placeholder: "例如：2026-06" },
];

const SOURCE_ACCEPT = ".docx,.md,.markdown";

export function PaperTypesetting() {
  const [query, setQuery] = useState("");
  const [variantId, setVariantId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const templatesQuery = useFormattingTemplates(query.trim());
  const submit = useSubmitFormatting();
  const templates = useMemo(() => templatesQuery.data?.templates ?? [], [templatesQuery.data]);
  const counts = templatesQuery.data?.counts;

  const options = useMemo(() => templates.flatMap((template: FormattingTemplateRecord) => template.variants.map((variant) => ({ template, variant }))), [templates]);
  const selected = options.find((option) => option.variant.id === variantId);
  const requiredFields = useMemo(() => new Set(selected?.variant.requiredMetadata ?? ["title", "authors"]), [selected]);
  const visibleFields = METADATA_FIELDS.filter((field) => field.required || requiredFields.has(field.key) || field.key === "institution" || field.key === "degreeType" || field.key === "studentId" || field.key === "department" || field.key === "major" || field.key === "supervisor" || field.key === "date");

  async function start(event: React.FormEvent) {
    event.preventDefault();
    if (!selected?.variant.canSubmit) { setMessage("请先选择可提交的学校模板"); return; }
    if (!file) { setMessage("请选择 DOCX 或 Markdown 原稿"); return; }
    const missing = [...requiredFields].filter((key) => !(values[key] ?? "").trim());
    if (missing.length) { setMessage(`请补齐：${missing.map((key) => METADATA_FIELDS.find((field) => field.key === key)?.label ?? key).join("、")}`); return; }
    const authors = (values.authors ?? "").split(/[、,，;；]/).map((value) => value.trim()).filter(Boolean);
    if (!authors.length) { setMessage("请填写至少一位作者"); return; }
    setMessage("");
    try {
      const task = await submit.mutateAsync({ file, submission: { requestKey: crypto.randomUUID().replace(/-/g, ""), templateVariantId: selected.variant.id, metadata: { ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value.trim()]).filter(([, value]) => value)), authors } } });
      window.location.assign(`/papers/formatting/${task.id}`);
    } catch (error) {
      setMessage(errorMessage(error, "提交失败，请稍后重试"));
    }
  }

  return (
    <main className="h-full overflow-y-auto bg-[var(--color-bg)]">
      <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-10">
        <Link href="/papers" className="inline-flex items-center gap-1 text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"><ArrowLeft width={14} height={14} />我的排版任务</Link>
        <div className="mt-6 flex items-start justify-between gap-5">
          <div className="flex items-start gap-4"><LayoutLeft className="mt-1 text-[var(--color-accent)]" width={28} height={28} strokeWidth={1.5} /><div><h1 className="text-2xl font-semibold tracking-[-0.025em] text-[var(--color-text-primary)]">论文排版</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-text-secondary)]">选择学校模板，上传 Word 或 Markdown 原稿，后台自动识别章节结构并按学校模板排版，完成后在这里预览和下载 PDF。</p></div></div>
          <BookStack className="hidden text-[var(--color-accent)] sm:block" width={28} height={28} strokeWidth={1.5} />
        </div>

        <form onSubmit={start} className="mt-8 space-y-4">
          <section className="bg-[var(--color-panel)] px-5 py-6 sm:px-6">
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">1 · 选择学校与模板</h2>
            <p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">只有通过当前快照隔离编译验证的模板可以提交。暂不可用的模板仍会显示原因，方便你确认格式是否受支持。</p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <input value={query} onChange={(event) => { setQuery(event.target.value); setVariantId(""); }} placeholder="输入学校名称搜索" aria-label="搜索学校模板" className="min-h-10 min-w-0 flex-1 rounded-[var(--radius-md)] bg-[var(--color-bg)] px-3 text-sm text-[var(--color-text-primary)] outline-none ring-1 ring-[var(--color-border-light)] placeholder:text-[var(--color-text-tertiary)] focus:ring-[var(--color-accent)]" />
              {counts ? <span className="text-[11px] text-[var(--color-text-tertiary)]">记录 {counts.records} · LaTeX {counts.latex} · 已验证 {counts.verified} · 可提交 {counts.submittable}</span> : null}
            </div>
            <div className="mt-4 grid gap-2 md:grid-cols-2">
              {templatesQuery.isPending ? <p className="text-xs text-[var(--color-text-tertiary)]">正在读取模板…</p> : templates.length === 0 ? <p className="text-xs text-[var(--color-text-tertiary)]">没有匹配的学校模板。</p> : templates.map((template) => (
                <div key={template.id} className="bg-[var(--color-panel-muted)] px-4 py-4">
                  <div className="flex items-start justify-between gap-3"><h3 className="text-sm font-medium text-[var(--color-text-primary)]">{template.university}</h3><span className="shrink-0 text-[11px] text-[var(--color-text-tertiary)]">{template.degreeType ?? "学位未知"} · {template.year ?? "年份未知"}</span></div>
                  {template.repositoryUrl || template.officialSpecUrl ? <p className="mt-1 truncate text-[11px] text-[var(--color-text-tertiary)]">来源：<a href={template.repositoryUrl ?? template.officialSpecUrl ?? "#"} target="_blank" rel="noreferrer" className="text-[var(--color-accent)] hover:underline">{template.repositoryUrl ? "模板仓库" : "学校规范"}</a></p> : null}
                  <div className="mt-3 space-y-1.5">
                    {template.variants.map((variant: FormattingTemplateVariant) => (
                      <div key={variant.id} className={`flex items-center gap-2 rounded-[var(--radius-md)] px-3 py-2 text-xs ${variantId === variant.id ? "bg-[var(--color-accent-muted)]" : ""}`}>
                        <button type="button" onClick={() => { setVariantId(variant.id); setMessage(""); }} disabled={!variant.canSubmit} className={`min-w-0 flex-1 truncate text-left transition-colors ${variantId === variant.id ? "text-[var(--color-text-primary)]" : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"} disabled:cursor-not-allowed disabled:opacity-60`}>
                          {variant.variantKey}
                        </button>
                        {variant.sampleAvailable ? <a href={`/api/papers/templates/${variant.id}/sample`} target="_blank" rel="noreferrer" className="shrink-0 text-[11px] text-[var(--color-text-tertiary)] hover:text-[var(--color-accent)]">样例 PDF</a> : null}
                        <span className={`shrink-0 text-[11px] ${variant.canSubmit ? "text-[var(--color-accent)]" : "text-[var(--color-text-tertiary)]"}`}>{variant.canSubmit ? "可提交" : variant.reason ?? "暂不可用"}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="bg-[var(--color-panel)] px-5 py-6 sm:px-6">
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">2 · 填写论文信息</h2>
            <p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">这些信息会写入模板封面与页眉，不参与正文改写。</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {visibleFields.map((field) => (
                <label key={field.key} className={field.wide ? "sm:col-span-2" : undefined}>
                  <span className="mb-1.5 block text-xs font-medium text-[var(--color-text-secondary)]">{field.label}{requiredFields.has(field.key) ? <span className="text-[var(--color-danger)]"> *</span> : null}</span>
                  <input value={values[field.key] ?? ""} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} placeholder={field.placeholder} aria-label={field.label} className="min-h-10 w-full rounded-[var(--radius-md)] bg-[var(--color-bg)] px-3 text-sm text-[var(--color-text-primary)] outline-none ring-1 ring-[var(--color-border-light)] placeholder:text-[var(--color-text-tertiary)] focus:ring-[var(--color-accent)]" />
                </label>
              ))}
            </div>
          </section>

          <section className="bg-[var(--color-panel)] px-5 py-6 sm:px-6">
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">3 · 上传原稿</h2>
            <p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">支持 DOCX 与 Markdown（.md / .markdown），最大 20 MB。旧版 .doc 请先在 Word 中另存为 .docx。Markdown 中的图片需要是可访问的公共链接，否则会提示补齐。</p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-panel-muted)] px-4 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"><Upload width={16} height={16} />{file ? "重新选择原稿" : "选择原稿"}<input type="file" accept={SOURCE_ACCEPT} className="sr-only" aria-label="上传论文原稿" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
              {file ? <span className="text-xs text-[var(--color-text-secondary)]">{file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB</span> : <span className="text-xs text-[var(--color-text-tertiary)]">尚未选择文件</span>}
            </div>
          </section>

          {message ? <p className="rounded-[var(--radius-md)] bg-[var(--color-danger-muted)] px-4 py-3 text-xs text-[var(--color-danger)]">{message}</p> : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="primary" size="sm" disabled={submit.isPending || !selected?.variant.canSubmit || !file}><CheckCircle width={16} height={16} />{submit.isPending ? "正在提交…" : "提交后台排版"}</Button>
            <span className="text-[11px] text-[var(--color-text-tertiary)]">提交后可以离开页面，排版进度会通过站内通知提醒。</span>
          </div>
        </form>

        <p className="mt-6 text-[11px] text-[var(--color-text-tertiary)]">需要完整模板资料？<Link href="/papers/templates" className="text-[var(--color-accent)] hover:underline">浏览模板库<NavArrowRight className="inline" width={12} height={12} /></Link></p>
      </div>
    </main>
  );
}
