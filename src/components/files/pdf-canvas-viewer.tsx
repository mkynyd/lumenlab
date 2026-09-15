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

/** 采样判断画布是否几乎全白，用来识别「字形缺失」这种整页空白。 */
function looksBlank(canvas: HTMLCanvasElement): boolean {
  const context = canvas.getContext("2d");
  if (!context || !canvas.width || !canvas.height) return false;
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  let inked = 0;
  let sampled = 0;
  for (let index = 0; index < data.length; index += 4 * 16) {
    sampled += 1;
    if (data[index] < 240 || data[index + 1] < 240 || data[index + 2] < 240) {
      inked += 1;
    }
  }
  // 阈值取 1%：正常文本文档的着墨比例远高于此，而「只有几条分隔线」的
  // 字形缺失页通常不到 0.4%，卡在 0.2% 会漏判。
  return sampled > 0 && inked / sampled < 0.01;
}

export function PdfCanvasViewer({
  url,
  title,
  onViewParsed,
}: {
  url: string;
  title: string;
  /** 原件画不出来时，给用户一条通往文本层的路。 */
  onViewParsed?: () => void;
}) {
  const [pageCount, setPageCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [missingGlyphs, setMissingGlyphs] = useState(false);
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

        // 画完再看一眼：整份几乎全白说明这份 PDF 没有可绘制的字形，
        // 换任何阅读器都一样，得把用户引到文本层而不是留一片白。
        if (!cancelled && canvasRefs.current.length > 0) {
          setMissingGlyphs(
            canvasRefs.current.every(
              (canvas) => canvas !== null && looksBlank(canvas)
            )
          );
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
      {missingGlyphs && (
        <div
          role="status"
          className="rounded-[var(--radius-md)] bg-[var(--color-warning-muted)] px-3 py-2.5 text-xs leading-relaxed text-[var(--color-warning)]"
        >
          <p className="font-medium">这份 PDF 的文字显示不出来</p>
          <p className="mt-0.5">
            原件里只记录了文字的位置，没有嵌入可绘制的字形，所以浏览器和系统阅读器都画不出内容——下载后换别的阅读器也一样。它的文本层是完好的，可以看解析内容。
          </p>
          {onViewParsed && (
            <button
              type="button"
              onClick={onViewParsed}
              className="mt-1.5 underline underline-offset-2"
            >
              查看解析内容
            </button>
          )}
        </div>
      )}
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
