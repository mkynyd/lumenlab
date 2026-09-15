"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";

/**
 * 用 PDF.js 把原件逐页画到 canvas，而不是交给浏览器内置的 PDF 查看器。
 *
 * 内置查看器在部分嵌入子集字体的 PDF 上会整页画不出来（页面上只剩几条线），
 * 换 PDF.js 能拿到一致的渲染结果，也顺手统一了各家浏览器的表现。PDF.js 自己
 * 按需发 Range 请求，所以大文件不必先整个下载到内存。
 *
 * 加载文档与绘制分成两个 effect：canvas 由 pageCount 驱动渲染，必须等这一轮
 * 提交之后才能拿到 ref，否则绘制循环跑在元素挂载之前，画布会停在默认尺寸。
 */
export function PdfCanvasViewer({ url, title }: { url: string; title: string }) {
  const [pageCount, setPageCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const documentRef = useRef<PDFDocumentProxy | null>(null);
  const canvasRefs = useRef<Array<HTMLCanvasElement | null>>([]);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.mjs",
          import.meta.url
        ).toString();
        const document = await pdfjs.getDocument({ url }).promise;
        if (!active) return;
        documentRef.current = document;
        setPageCount(document.numPages);
      } catch {
        if (active) {
          setError("这份 PDF 无法在线渲染。可以下载原件，用本机阅读器打开。");
        }
      }
    })();

    return () => {
      active = false;
      documentRef.current = null;
    };
  }, [url]);

  useEffect(() => {
    if (pageCount === 0) return;
    let cancelled = false;

    (async () => {
      const document = documentRef.current;
      if (!document) return;
      try {
        for (let index = 1; index <= document.numPages; index += 1) {
          if (cancelled) return;
          const canvas = canvasRefs.current[index - 1];
          if (!canvas) continue;
          const page = await document.getPage(index);
          if (cancelled) return;
          const viewport = page.getViewport({ scale: 1.5 });
          const context = canvas.getContext("2d");
          if (!context) continue;
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.width = "100%";
          canvas.style.height = "auto";
          await page.render({ canvasContext: context, viewport, canvas }).promise;
        }
      } catch {
        if (!cancelled) {
          setError("这份 PDF 无法在线渲染。可以下载原件，用本机阅读器打开。");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pageCount]);

  if (error) {
    return (
      <p className="py-12 text-center text-sm text-[var(--color-text-secondary)]">
        {error}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {pageCount === 0 && (
        <div className="flex h-40 items-center justify-center text-sm text-[var(--color-text-secondary)]">
          正在渲染原件…
        </div>
      )}
      {Array.from({ length: pageCount }, (_, index) => (
        <canvas
          key={index}
          ref={(element) => {
            canvasRefs.current[index] = element;
          }}
          aria-label={`${title} 第 ${index + 1} 页`}
          className="w-full rounded-[var(--radius-md)] bg-white"
        />
      ))}
    </div>
  );
}
