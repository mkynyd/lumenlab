"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { NavArrowDown, NavArrowUp } from "iconoir-react";
import { Button } from "@/components/ui/button";

interface SyncTexLocation {
  nodeId: string;
  kind: string;
  page: number;
  line: number;
  sourceFile: string | null;
}

interface PdfjsPage {
  getViewport: (options: { scale: number }) => { width: number; height: number };
  render: (options: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number }; canvas: HTMLCanvasElement }) => { promise: Promise<unknown> };
}

interface PdfjsDocument {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfjsPage>;
  destroy: () => Promise<void>;
}

// 视口上下各预取的距离；进入该范围的页面才开始光栅化，长论文不会一次性吃掉内存。
const LAZY_ROOT_MARGIN = "600px 0px";

export function PaperPdfViewer({ pdfUrl, mapUrl, selectedNodeId }: { pdfUrl: string; mapUrl?: string; selectedNodeId?: string | null }) {
  // pdfUrl 变化时整体重挂载，天然重置页码 / 已渲染缓存 / 错误状态。
  return <PaperPdfViewerInner key={pdfUrl} pdfUrl={pdfUrl} mapUrl={mapUrl} selectedNodeId={selectedNodeId} />;
}

function PaperPdfViewerInner({ pdfUrl, mapUrl, selectedNodeId }: { pdfUrl: string; mapUrl?: string; selectedNodeId?: string | null }) {
  const [pageCount, setPageCount] = useState(0);
  const [locations, setLocations] = useState<SyncTexLocation[]>([]);
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [renderedPages, setRenderedPages] = useState<ReadonlySet<number>>(new Set());
  const renderedRef = useRef<Set<number>>(new Set());
  const renderingRef = useRef<Set<number>>(new Set());
  const documentRef = useRef<PdfjsDocument | null>(null);
  const canvasRefs = useRef<Array<HTMLCanvasElement | null>>([]);
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);

  const markRendered = useCallback((index: number) => {
    renderedRef.current.add(index);
    setRenderedPages(new Set(renderedRef.current));
  }, []);

  const requestRender = useCallback((index: number) => {
    const document = documentRef.current;
    if (!document || index < 0 || index >= document.numPages) return;
    if (renderedRef.current.has(index) || renderingRef.current.has(index)) return;
    renderingRef.current.add(index);
    void (async () => {
      try {
        const pdfPage = await document.getPage(index + 1);
        const viewport = pdfPage.getViewport({ scale: 1.15 });
        const canvas = canvasRefs.current[index];
        const context = canvas?.getContext("2d");
        if (canvas && context) {
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.width = "100%";
          canvas.style.height = "auto";
          await pdfPage.render({ canvasContext: context, viewport, canvas }).promise;
          markRendered(index);
        }
      } catch {
        // 单页光栅化失败不应拖垮整个预览；该页保持占位。
      } finally {
        renderingRef.current.delete(index);
      }
    })();
  }, [markRendered]);

  useEffect(() => {
    let active = true;
    async function loadPdf() {
      try {
        const [{ getDocument, GlobalWorkerOptions }, response] = await Promise.all([
          import("pdfjs-dist/legacy/build/pdf.mjs"),
          fetch(pdfUrl, { credentials: "same-origin" }),
        ]);
        if (!response.ok) throw new Error("PDF 暂不可用");
        GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url).toString();
        // CID-keyed CJK fonts need pdf.js's own CMap/standard-font tables; without
        // them the preview silently drops every Chinese glyph. `scripts/copy-pdfjs-assets.ts`
        // copies them into public/pdfjs before dev/build.
        const document = (await getDocument({
          data: new Uint8Array(await response.arrayBuffer()),
          cMapUrl: "/pdfjs/cmaps/",
          cMapPacked: true,
          standardFontDataUrl: "/pdfjs/standard_fonts/",
        }).promise) as unknown as PdfjsDocument;
        if (!active) {
          await document.destroy();
          return;
        }
        documentRef.current = document;
        setPageCount(document.numPages);
        // 无 IntersectionObserver 的环境（旧浏览器、测试）退化为按需顺序渲染全部页面。
        if (typeof IntersectionObserver === "undefined") {
          for (let index = 0; index < document.numPages; index += 1) requestRender(index);
        }
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "PDF 加载失败");
      }
    }
    void loadPdf();
    return () => {
      active = false;
      const document = documentRef.current;
      documentRef.current = null;
      if (document) void Promise.resolve(document.destroy()).catch(() => undefined);
    };
  }, [pdfUrl, requestRender]);

  useEffect(() => {
    if (!pageCount || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const index = Number((entry.target as HTMLElement).dataset.pageIndex);
        if (Number.isInteger(index)) requestRender(index);
      }
    }, { rootMargin: LAZY_ROOT_MARGIN, threshold: 0 });
    for (const element of pageRefs.current) {
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [pageCount, requestRender]);

  useEffect(() => {
    if (!mapUrl) return;
    let active = true;
    void fetch(mapUrl, { credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) throw new Error("SyncTeX 映射暂不可用");
        return response.json() as Promise<{ locations?: SyncTexLocation[] }>;
      })
      .then((result) => { if (active) setLocations(result.locations ?? []); })
      .catch(() => { if (active) setLocations([]); });
    return () => { active = false; };
  }, [mapUrl]);

  useEffect(() => {
    if (!selectedNodeId) return;
    const location = locations.find((item) => item.nodeId === selectedNodeId);
    if (!location) return;
    requestRender(location.page - 1);
    pageRefs.current[location.page - 1]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [locations, selectedNodeId, requestRender]);

  function movePage(delta: number) {
    const nextPage = Math.max(1, Math.min(pageCount || 1, page + delta));
    setPage(nextPage);
    requestRender(nextPage - 1);
    pageRefs.current[nextPage - 1]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  const selectedLocation = locations.find((item) => item.nodeId === selectedNodeId);
  const visiblePage = selectedLocation?.page ?? page;
  return <div className="mt-4 space-y-3">
    <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--color-text-tertiary)]">
      <span aria-live="polite">{pageCount ? `第 ${visiblePage} / ${pageCount} 页` : "正在加载 PDF…"}</span>
      <span className="flex items-center gap-1">
        <Button type="button" variant="ghost" size="icon" aria-label="上一页" onClick={() => movePage(-1)} disabled={page <= 1}><NavArrowUp width={14} height={14} /></Button>
        <Button type="button" variant="ghost" size="icon" aria-label="下一页" onClick={() => movePage(1)} disabled={!pageCount || page >= pageCount}><NavArrowDown width={14} height={14} /></Button>
      </span>
    </div>
    {selectedLocation ? <p className="rounded-[var(--radius-sm)] bg-[var(--color-info-muted)] px-2 py-1 text-[11px] leading-4 text-[var(--color-text-secondary)]">{selectedLocation.nodeId} · PDF 第 {selectedLocation.page} 页 · {selectedLocation.sourceFile ?? "generated-content.tex"}:{selectedLocation.line}</p> : null}
    {error ? <p className="rounded-[var(--radius-sm)] bg-[var(--color-danger-muted)] px-2 py-2 text-xs text-[var(--color-danger)]">{error}</p> : null}
    <div className="space-y-3 overflow-y-auto pr-1" aria-label="论文 PDF 页面">
      {Array.from({ length: pageCount }, (_, index) => {
        const rendered = renderedPages.has(index);
        return (
          <div key={index + 1} ref={(element) => { pageRefs.current[index] = element; }} data-page-index={index} className={`relative bg-white shadow-sm ring-1 ${visiblePage === index + 1 ? "ring-[var(--color-accent)]" : "ring-black/5"}`}>
            {!rendered ? <div className="flex w-full items-center justify-center bg-[var(--color-panel-muted)] text-[11px] text-[var(--color-text-tertiary)]" style={{ aspectRatio: "1 / 1.414" }} aria-hidden="true">第 {index + 1} 页加载中…</div> : null}
            <canvas ref={(element) => { canvasRefs.current[index] = element; }} className={rendered ? "block" : "hidden"} aria-label={`PDF 第 ${index + 1} 页`} />
          </div>
        );
      })}
    </div>
  </div>;
}
