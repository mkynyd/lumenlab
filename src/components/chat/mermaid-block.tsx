"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { logger } from "@/lib/logger";

interface MermaidBlockProps {
  code: string;
  isStreaming?: boolean;
}

const MERMAID_THEME = {
  theme: "base" as const,
  themeVariables: {
    primaryColor: "#FFFFFF",
    primaryBorderColor: "#3B82F6",
    primaryTextColor: "#1E293B",
    lineColor: "#64748B",
    secondaryColor: "#FFFFFF",
    tertiaryColor: "#FFFFFF",
    noteBkgColor: "#FFFFFF",
    noteBorderColor: "#F59E0B",
    noteTextColor: "#1E293B",
  },
};

function parseSvgLength(value: string | null) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?(px)?$/.test(trimmed)) return null;
  return Number.parseFloat(trimmed);
}

function getViewBoxSize(svgElement: SVGSVGElement) {
  const viewBox = svgElement.getAttribute("viewBox");
  if (!viewBox) return null;
  const [, , width, height] = viewBox
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  return { width, height };
}

function getSvgExportSource(
  svgText: string,
  container: HTMLDivElement | null
) {
  const renderedSvg = container?.querySelector("svg");
  if (!renderedSvg) {
    return { source: svgText, width: 800, height: 600 };
  }

  const clone = renderedSvg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");

  const viewBoxSize = getViewBoxSize(clone);
  const rect = renderedSvg.getBoundingClientRect();
  const width =
    parseSvgLength(clone.getAttribute("width")) ||
    Math.ceil(rect.width) ||
    viewBoxSize?.width ||
    800;
  const height =
    parseSvgLength(clone.getAttribute("height")) ||
    Math.ceil(rect.height) ||
    viewBoxSize?.height ||
    600;

  if (!clone.getAttribute("viewBox")) {
    clone.setAttribute("viewBox", `0 0 ${width} ${height}`);
  }
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  clone.setAttribute("style", "background: #ffffff;");

  return {
    source: new XMLSerializer().serializeToString(clone),
    width,
    height,
  };
}

export function MermaidBlock({ code, isStreaming = false }: MermaidBlockProps) {
  const rawId = useId();
  const id = `mermaid-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isStreaming || !code.trim()) return;
    let cancelled = false;
    void (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "loose",
          suppressErrorRendering: true,
          ...MERMAID_THEME,
        });
        const { svg: renderedSvg } = await mermaid.render(id, code);
        if (!cancelled) {
          setSvg(renderedSvg);
          setFailed(false);
          setErrorMsg("");
        }
      } catch (err) {
        if (!cancelled) {
          setFailed(true);
          setSvg(null);
          setErrorMsg(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, id, isStreaming]);

  function downloadPNG() {
    if (!svg) return;

    const exportSvg = getSvgExportSource(svg, containerRef.current);
    const blob = new Blob([exportSvg.source], {
      type: "image/svg+xml;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const img = new Image();

    img.onload = () => {
      const scale = Math.max(2, Math.min(window.devicePixelRatio || 2, 3));
      const w = img.naturalWidth || exportSvg.width;
      const h = img.naturalHeight || exportSvg.height;
      const canvas = document.createElement("canvas");
      canvas.width = w * scale;
      canvas.height = h * scale;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        return;
      }
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);

      canvas.toBlob((pngBlob) => {
        if (!pngBlob) return;
        const downloadUrl = URL.createObjectURL(pngBlob);
        const a = document.createElement("a");
        a.href = downloadUrl;
        a.download = `mermaid-${id}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(downloadUrl);
      }, "image/png");
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      logger.error("SVG 加载失败", { context: "Mermaid PNG export" });
    };

    img.src = url;
  }

  function downloadSVG() {
    if (!svg) return;
    const exportSvg = getSvgExportSource(svg, containerRef.current);
    const blob = new Blob([exportSvg.source], {
      type: "image/svg+xml;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mermaid-${id}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  if (isStreaming) {
    return (
      <pre data-render-state="pending" className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-xs">
        <code className="language-mermaid">{code}</code>
      </pre>
    );
  }

  if (failed || !svg) {
    return (
      <div
        data-render-state={failed ? "failed" : "pending"}
        className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
      >
        <pre className="overflow-x-auto text-xs">
          <code className="language-mermaid">{code}</code>
        </pre>
        {errorMsg && (
          <p className="mt-2 text-xs text-[var(--color-error)]">
            Mermaid 渲染失败：{errorMsg}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="group relative" data-render-state="ready">
      <div
        ref={containerRef}
        className="mermaid overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white p-3"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <Button
          type="button"
          onClick={downloadPNG}
          variant="ghost"
          size="xs"
          className="bg-[var(--color-surface)]"
          title="下载 PNG（2x 分辨率）"
        >
          <Download data-icon="inline-start" />
          PNG
        </Button>
        <Button
          type="button"
          onClick={downloadSVG}
          variant="ghost"
          size="xs"
          className="bg-[var(--color-surface)]"
          title="下载 SVG（矢量）"
        >
          <Download data-icon="inline-start" />
          SVG
        </Button>
      </div>
    </div>
  );
}
