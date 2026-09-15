"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 在浏览器里直接渲染 Office 原件，不经过服务端转换。
 *
 * 三个库各自覆盖一族 OOXML：pptx-preview 出幻灯片、docx-preview 出文档流、
 * xlsx（SheetJS）出表格。都是 `*x` 结尾的新格式，`.ppt`/`.doc`/`.xls` 这类
 * 二进制旧格式以及 WPS 自有格式不在覆盖范围里，会退回「下载原件」。
 */

type OfficeKind = "pptx" | "docx" | "sheet";

function officeKind(mimeType: string): OfficeKind | null {
  if (mimeType.includes("presentationml.presentation")) return "pptx";
  if (mimeType.includes("wordprocessingml.document")) return "docx";
  if (mimeType.includes("spreadsheetml.sheet")) return "sheet";
  return null;
}

export function OfficeCanvasViewer({
  url,
  mimeType,
  title,
}: {
  url: string;
  mimeType: string;
  title: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const kind = officeKind(mimeType);

  useEffect(() => {
    if (!kind) return;
    let active = true;
    let dispose: (() => void) | undefined;

    (async () => {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`fetch ${response.status}`);
        const buffer = await response.arrayBuffer();
        const container = containerRef.current;
        if (!active || !container) return;

        if (kind === "pptx") {
          const { init } = await import("pptx-preview");
          // 幻灯片是 16:9，高度必须按容器宽度算；写死高度会把上下裁掉。
          const width = container.clientWidth || 960;
          const previewer = init(container, {
            width,
            height: Math.round((width * 9) / 16),
            mode: "slide",
          });
          await previewer.preview(buffer);
          dispose = () => previewer.destroy();
        } else if (kind === "docx") {
          const { renderAsync } = await import("docx-preview");
          await renderAsync(buffer, container, undefined, {
            inWrapper: false,
            ignoreWidth: false,
            breakPages: true,
          });
        } else {
          const XLSX = await import("xlsx");
          const workbook = XLSX.read(buffer, { type: "array" });
          container.innerHTML = workbook.SheetNames.map(
            (name) => `<section class="office-sheet">${XLSX.utils.sheet_to_html(workbook.Sheets[name])}</section>`
          ).join("");
        }

        if (active) setStatus("ready");
      } catch {
        if (active) setStatus("error");
      }
    })();

    return () => {
      active = false;
      dispose?.();
    };
  }, [url, kind]);

  if (!kind) {
    return null;
  }

  if (status === "error") {
    return (
      <p className="py-12 text-center text-sm text-[var(--color-text-secondary)]">
        这份文件无法在线渲染。可以下载原件，用本机 Office / WPS 打开。
      </p>
    );
  }

  return (
    <div className="relative">
      {status === "loading" && (
        <div className="flex h-40 items-center justify-center text-sm text-[var(--color-text-secondary)]">
          正在渲染原件…
        </div>
      )}
      <div
        ref={containerRef}
        aria-label={`${title} 原件`}
        className="office-preview w-full overflow-x-auto"
      />
    </div>
  );
}
