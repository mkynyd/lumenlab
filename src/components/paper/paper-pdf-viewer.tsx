"use client";

import { useEffect, useRef, useState } from "react";
import { NavArrowDown, NavArrowUp } from "iconoir-react";
import { Button } from "@/components/ui/button";

interface SyncTexLocation {
  nodeId: string;
  kind: string;
  page: number;
  line: number;
  sourceFile: string | null;
}

export function PaperPdfViewer({ pdfUrl, mapUrl, selectedNodeId }: { pdfUrl: string; mapUrl?: string; selectedNodeId?: string | null }) {
  const [pageCount, setPageCount] = useState(0);
  const [locations, setLocations] = useState<SyncTexLocation[]>([]);
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const canvasRefs = useRef<Array<HTMLCanvasElement | null>>([]);
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);

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
        const document = await getDocument({ data: new Uint8Array(await response.arrayBuffer()) }).promise;
        if (!active) {
          await document.destroy();
          return;
        }
        setPageCount(document.numPages);
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
        for (let index = 1; index <= document.numPages; index += 1) {
          const pdfPage = await document.getPage(index);
          const viewport = pdfPage.getViewport({ scale: 1.15 });
          const canvas = canvasRefs.current[index - 1];
          if (!canvas || !active) continue;
          const context = canvas.getContext("2d");
          if (!context) continue;
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.width = "100%";
          canvas.style.height = "auto";
          await pdfPage.render({ canvasContext: context, viewport, canvas }).promise;
        }
        await document.destroy();
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "PDF 加载失败");
      }
    }
    void loadPdf();
    return () => { active = false; };
  }, [pdfUrl]);

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
    pageRefs.current[location.page - 1]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [locations, selectedNodeId]);

  function movePage(delta: number) {
    const nextPage = Math.max(1, Math.min(pageCount || 1, page + delta));
    setPage(nextPage);
    pageRefs.current[nextPage - 1]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  const selectedLocation = locations.find((item) => item.nodeId === selectedNodeId);
  const visiblePage = selectedLocation?.page ?? page;
  return <div className="mt-4 space-y-3">
    <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--color-text-tertiary)]">
      <span>{pageCount ? `第 ${visiblePage} / ${pageCount} 页` : "正在加载 PDF…"}</span>
      <span className="flex items-center gap-1">
        <Button type="button" variant="ghost" size="icon" aria-label="上一页" onClick={() => movePage(-1)} disabled={page <= 1}><NavArrowUp width={14} height={14} /></Button>
        <Button type="button" variant="ghost" size="icon" aria-label="下一页" onClick={() => movePage(1)} disabled={!pageCount || page >= pageCount}><NavArrowDown width={14} height={14} /></Button>
      </span>
    </div>
    {selectedLocation ? <p className="rounded-[var(--radius-sm)] bg-[var(--color-info-muted)] px-2 py-1 text-[11px] leading-4 text-[var(--color-text-secondary)]">{selectedLocation.nodeId} · PDF 第 {selectedLocation.page} 页 · {selectedLocation.sourceFile ?? "generated-content.tex"}:{selectedLocation.line}</p> : null}
    {error ? <p className="rounded-[var(--radius-sm)] bg-[var(--color-danger-muted)] px-2 py-2 text-xs text-[var(--color-danger)]">{error}</p> : null}
    <div className="space-y-3 overflow-y-auto pr-1" aria-label="论文 PDF 页面">
      {Array.from({ length: pageCount }, (_, index) => <div key={index + 1} ref={(element) => { pageRefs.current[index] = element; }} className={`bg-white shadow-sm ring-1 ${visiblePage === index + 1 ? "ring-[var(--color-accent)]" : "ring-black/5"}`}>
        <canvas ref={(element) => { canvasRefs.current[index] = element; }} aria-label={`PDF 第 ${index + 1} 页`} />
      </div>)}
    </div>
  </div>;
}
