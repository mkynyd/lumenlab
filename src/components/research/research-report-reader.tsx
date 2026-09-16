"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, Xmark } from "iconoir-react";
import { Button } from "@/components/ui/button";
import { MarkdownContent } from "@/components/markdown/markdown-content";
import { ResearchReportEvidencePanel, ResearchCitationCard } from "@/components/research/research-report-evidence-panel";
import { linkifyResearchEvidenceMarkers, researchEvidenceIdFromAnchor } from "@/lib/research/report-citations";
import type { ResearchCitationMap } from "@/lib/research/research-view-model";

/** 悬浮引用卡的估计高度，用于判断是否向上翻转。 */
const TOOLTIP_ESTIMATED_HEIGHT = 320;

interface ReaderEvidence {
  id: string;
  [key: string]: unknown;
}

interface ReaderReportSnapshot {
  generatedAt: string;
  citationMap?: ResearchCitationMap;
  reportDocument: {
    title?: string | null;
    body?: string | null;
    evidenceRefs?: string[];
  };
}

function reportOutline(markdown: string): Array<{ level: number; title: string }> {
  return markdown
    .split("\n")
    .flatMap((line) => {
      const match = /^(#{2,3})\s+(.+?)\s*$/.exec(line);
      if (!match) return [];
      return [{ level: match[1].length, title: match[2].replace(/\[(.*?)\]\(.*?\)/g, "$1").replace(/[*_`]/g, "") }];
    })
    .slice(0, 16);
}

/**
 * 研究报告全屏阅读器（成果详情态）：左侧浮动目录卡 + 居中正文 + 右侧来源与证据栏。
 * 引用编号支持 hover/焦点悬浮预览，点击选中右侧证据详情。
 */
export function ResearchReportReader({
  reportSnapshot,
  evidence,
  claims,
  onClose,
  onExport,
  exported,
}: {
  reportSnapshot: ReaderReportSnapshot;
  evidence: ReaderEvidence[];
  claims: unknown[];
  onClose: () => void;
  onExport: () => void;
  exported: boolean;
}) {
  const rawBody = reportSnapshot.reportDocument.body ?? "";
  const evidenceRefs = useMemo(() => reportSnapshot.reportDocument.evidenceRefs ?? [], [reportSnapshot.reportDocument.evidenceRefs]);
  const body = useMemo(() => linkifyResearchEvidenceMarkers(rawBody, evidenceRefs), [rawBody, evidenceRefs]);
  const outline = useMemo(() => reportOutline(rawBody), [rawBody]);

  const citationIndex = useMemo(() => {
    const index = new Map<string, NonNullable<ResearchCitationMap[string]>[number]>();
    for (const entries of Object.values(reportSnapshot.citationMap ?? {})) {
      for (const entry of entries) if (!index.has(entry.evidenceId)) index.set(entry.evidenceId, entry);
    }
    return index;
  }, [reportSnapshot.citationMap]);
  const evidenceById = useMemo(() => new Map(evidence.map((item) => [item.id, item])), [evidence]);
  const markerByEvidenceId = useMemo(() => new Map(evidenceRefs.map((id, index) => [id, `E${index + 1}`])), [evidenceRefs]);

  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string | null>(null);
  // hover/焦点预览卡：键盘 Tab 到引用时同样可见；触屏（hover: none）不渲染悬浮卡。
  const [hoveredMarker, setHoveredMarker] = useState<{ evidenceId: string; top: number; left: number; placement: "below" | "above" } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  function scrollToHeading(index: number) {
    const headings = containerRef.current?.querySelectorAll("h2, h3");
    headings?.item(index)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function citationFromEvent(event: React.MouseEvent<HTMLDivElement> | React.FocusEvent<HTMLDivElement>): { anchor: HTMLAnchorElement; evidenceId: string } | null {
    const anchor = (event.target as HTMLElement).closest("a");
    if (!(anchor instanceof HTMLAnchorElement)) return null;
    const evidenceId = researchEvidenceIdFromAnchor(anchor.getAttribute("href") ?? "");
    if (!evidenceId) return null;
    return { anchor, evidenceId };
  }

  function handleCitationClick(event: React.MouseEvent<HTMLDivElement>) {
    const found = citationFromEvent(event);
    if (!found) return;
    event.preventDefault();
    setSelectedEvidenceId(found.evidenceId);
    setHoveredMarker(null);
  }

  function showCitationPreview(event: React.MouseEvent<HTMLDivElement> | React.FocusEvent<HTMLDivElement>) {
    // 触屏设备没有稳定 hover：点击仍然选中侧栏详情，但不渲染悬浮卡。
    if (typeof window !== "undefined" && window.matchMedia?.("(hover: none)").matches) return;
    const found = citationFromEvent(event);
    if (!found) return;
    const container = containerRef.current;
    if (!container) return;
    const anchorRect = found.anchor.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const belowTop = anchorRect.bottom - containerRect.top + 8;
    // 锚点接近容器底部时向上展开，避免悬浮卡溢出容器。
    const flipsUp = belowTop + TOOLTIP_ESTIMATED_HEIGHT > containerRect.height;
    setHoveredMarker({
      evidenceId: found.evidenceId,
      top: flipsUp ? anchorRect.top - containerRect.top - 8 : belowTop,
      left: Math.max(0, Math.min(anchorRect.left - containerRect.left, containerRect.width - 320)),
      placement: flipsUp ? "above" : "below",
    });
  }

  function hideCitationPreview(event: React.MouseEvent<HTMLDivElement> | React.FocusEvent<HTMLDivElement>) {
    const found = citationFromEvent(event);
    if (!found) return;
    setHoveredMarker((current) => (current?.evidenceId === found.evidenceId ? null : current));
  }

  const hoveredCitation = hoveredMarker ? citationIndex.get(hoveredMarker.evidenceId) : undefined;
  const title = reportSnapshot.reportDocument.title ?? "研究报告";

  const outlineNav = (
    <nav aria-label="报告目录" className="min-w-0">
      <p className="px-2 text-[11px] font-medium text-[var(--color-text-tertiary)]">目录</p>
      <p className="mt-2 px-2 text-sm font-semibold leading-6 text-[var(--color-text-primary)]">{title}</p>
      <div className="mt-3 space-y-1">
        {outline.map((item, index) => (
          <button
            key={`${item.title}-${index}`}
            type="button"
            onClick={() => scrollToHeading(index)}
            className={`block w-full rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-xs leading-5 text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] ${item.level === 3 ? "pl-5" : ""}`}
          >
            {item.title}
          </button>
        ))}
      </div>
    </nav>
  );

  // 经由 portal 挂到 body：工作台主内容的 view-enter 动画会形成持久层叠上下文，
  // 直接内联渲染时 fixed/z-index 会被困在其中，侧边栏会盖住阅读器。
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={`阅读报告：${title}`} className="fixed inset-0 z-[110] overflow-y-auto overscroll-contain bg-[var(--color-bg)]">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 bg-[var(--color-bg)] px-4 py-3 sm:px-6">
        <Button type="button" variant="ghost" size="icon-sm" aria-label="关闭阅读器" onClick={onClose}>
          <Xmark width={18} height={18} />
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={onExport}>
          {exported ? <Check width={14} height={14} /> : <Copy width={14} height={14} />}
          {exported ? "已复制 Markdown" : "复制报告 Markdown"}
        </Button>
      </header>

      <div className="mx-auto w-full max-w-7xl px-4 pb-16 sm:px-6">
        {outline.length > 0 ? (
          <details className="mb-6 xl:hidden">
            <summary className="cursor-pointer select-none text-xs text-[var(--color-text-secondary)]">报告目录</summary>
            <div className="mt-2">{outlineNav}</div>
          </details>
        ) : null}

        <div className={`grid min-w-0 gap-8 ${outline.length > 0 ? "xl:grid-cols-[15rem_minmax(0,1fr)_19rem]" : "xl:grid-cols-[minmax(0,1fr)_19rem]"}`}>
          {outline.length > 0 ? (
            <div className="relative hidden xl:block">
              <div className="sticky top-20 rounded-[var(--radius-lg)] bg-[var(--color-panel)] px-4 py-4 shadow-lg">{outlineNav}</div>
            </div>
          ) : null}

          <article className="relative min-w-0 max-w-full">
            <h1 className="text-2xl font-semibold leading-9 text-[var(--color-text-primary)]">{title}</h1>
            <div
              ref={containerRef}
              className="relative mt-6 min-w-0 max-w-full"
              onClick={handleCitationClick}
              onMouseOver={showCitationPreview}
              onMouseOut={hideCitationPreview}
              onFocus={showCitationPreview}
              onBlur={hideCitationPreview}
            >
              <MarkdownContent content={body} className="min-w-0 max-w-full [overflow-wrap:anywhere]" />
            </div>
            {hoveredMarker && hoveredCitation ? (
              <div
                role="tooltip"
                className="pointer-events-none absolute z-20 hidden max-h-80 w-80 overflow-y-auto rounded-[var(--radius-md)] bg-[var(--color-panel)] px-4 py-3 shadow-lg sm:block"
                style={{
                  top: hoveredMarker.top,
                  left: hoveredMarker.left,
                  transform: hoveredMarker.placement === "above" ? "translateY(-100%)" : undefined,
                }}
              >
                <ResearchCitationCard entry={hoveredCitation} evidence={evidenceById.get(hoveredMarker.evidenceId) as never} marker={markerByEvidenceId.get(hoveredMarker.evidenceId)} className="" />
              </div>
            ) : null}
          </article>

          <div className="min-w-0">
            <ResearchReportEvidencePanel
              claims={claims as never}
              evidence={evidence as never}
              citationMap={reportSnapshot.citationMap}
              evidenceRefs={evidenceRefs}
              selectedEvidenceId={selectedEvidenceId}
              onSelectEvidence={setSelectedEvidenceId}
            />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
