"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { Check, Copy, Download, Maximize, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { copyText } from "@/lib/browser/copy-text";
import { logger } from "@/lib/logger";
import { ensureNodeLabels } from "@/lib/mermaid/ensure-node-labels";

interface MermaidViewerProps {
  code: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 3;
const SCALE_STEP = 0.25;

function resolveMermaidTheme() {
  if (typeof document === "undefined") {
    return {
      theme: "base" as const,
      themeVariables: {
        primaryColor: "#FFFFFF",
        primaryBorderColor: "#3B82F6",
        primaryTextColor: "#1E293B",
        lineColor: "#64748B",
        secondaryColor: "#F8FAFC",
        tertiaryColor: "#FFFFFF",
        noteBkgColor: "#FFFFFF",
        noteBorderColor: "#F59E0B",
        noteTextColor: "#1E293B",
      },
    };
  }

  const isDark = document.documentElement.classList.contains("dark");

  if (isDark) {
    return {
      theme: "base" as const,
      themeVariables: {
        primaryColor: "#1E293B",
        primaryBorderColor: "#60A5FA",
        primaryTextColor: "#E2E8F0",
        lineColor: "#94A3B8",
        secondaryColor: "#1E293B",
        tertiaryColor: "#0F172A",
        noteBkgColor: "#1E293B",
        noteBorderColor: "#FBBF24",
        noteTextColor: "#E2E8F0",
      },
    };
  }

  return {
    theme: "base" as const,
    themeVariables: {
      primaryColor: "#FFFFFF",
      primaryBorderColor: "#3B82F6",
      primaryTextColor: "#1E293B",
      lineColor: "#64748B",
      secondaryColor: "#F8FAFC",
      tertiaryColor: "#FFFFFF",
      noteBkgColor: "#FFFFFF",
      noteBorderColor: "#F59E0B",
      noteTextColor: "#1E293B",
    },
  };
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

function parseSvgLength(value: string | null) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?(px)?$/.test(trimmed)) return null;
  return Number.parseFloat(trimmed);
}

function normalizeExportSize(width: number, height: number) {
  const aspectRatio = width / Math.max(height, 1);
  if (aspectRatio <= 8) return { width, height };

  const minReadableHeight = 320;
  const maxCanvasWidth = 12_000;
  const targetHeight = Math.max(height, minReadableHeight);
  const targetWidth = Math.min(Math.ceil(targetHeight * aspectRatio), maxCanvasWidth);
  return {
    width: targetWidth,
    height: Math.ceil(targetWidth / aspectRatio),
  };
}

function getSvgExportSource(svgText: string, container: HTMLDivElement | null) {
  const renderedSvg = container?.querySelector("svg");
  if (!renderedSvg) {
    return { source: svgText, width: 800, height: 600 };
  }

  const clone = renderedSvg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");

  const viewBoxSize = getViewBoxSize(clone);
  const rect = renderedSvg.getBoundingClientRect();
  const naturalWidth =
    viewBoxSize?.width ||
    parseSvgLength(clone.getAttribute("width")) ||
    Math.ceil(rect.width) ||
    800;
  const naturalHeight =
    viewBoxSize?.height ||
    parseSvgLength(clone.getAttribute("height")) ||
    Math.ceil(rect.height) ||
    600;
  const { width, height } = normalizeExportSize(naturalWidth, naturalHeight);

  if (!clone.getAttribute("viewBox")) {
    clone.setAttribute("viewBox", `0 0 ${naturalWidth} ${naturalHeight}`);
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

export function MermaidViewer({ code, open, onOpenChange }: MermaidViewerProps) {
  const rawId = useId();
  const [viewerId, setViewerId] = useState(
    `mermaid-viewer-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}-0`
  );
  const [svg, setSvg] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [copiedSource, setCopiedSource] = useState(false);
  // 用 state 记录上一次 open，避免在 render 中读取 ref 而触发 lint。
  const [prevOpen, setPrevOpen] = useState(open);
  const dragStart = useRef({ x: 0, y: 0, posX: 0, posY: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const svgWrapperRef = useRef<HTMLDivElement>(null);
  const svgSizeRef = useRef({ width: 800, height: 600 });
  const renderCountRef = useRef(0);

  // 当对话框从关闭变为打开时，重置缩放、位置并清空旧 SVG，避免显示旧图。
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      if (scale !== 1) setScale(1);
      if (position.x !== 0 || position.y !== 0) setPosition({ x: 0, y: 0 });
      if (svg !== null) setSvg(null);
    }
  }

  // Render mermaid SVG on open with unique id to prevent stale DOM conflicts
  useEffect(() => {
    if (!open || !code.trim()) return;
    renderCountRef.current += 1;
    const id = `mermaid-viewer-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}-${renderCountRef.current}`;
    setViewerId(id);
    let cancelled = false;
    void (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "antiscript",
          suppressErrorRendering: true,
          flowchart: { htmlLabels: false },
          ...resolveMermaidTheme(),
        });
        const { svg: renderedSvg } = await mermaid.render(id, code);
        const cleanSvg = DOMPurify.sanitize(renderedSvg, {
          USE_PROFILES: { svg: true, html: true },
        });
        const labeledSvg = ensureNodeLabels(cleanSvg, code);
        if (!cancelled) {
          setSvg(labeledSvg);
        }
      } catch (err) {
        if (!cancelled) {
          logger.error("Mermaid 查看器渲染失败", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, rawId, open]);

  // Measure SVG natural size after render for boundary clamping
  useEffect(() => {
    if (!svg || !open) return;
    // Small delay to let DOM settle
    const timer = window.setTimeout(() => {
      const svgEl = containerRef.current?.querySelector("svg");
      if (!svgEl) return;
      const viewBox = svgEl.getAttribute("viewBox");
      if (viewBox) {
        const [, , w, h] = viewBox.split(/[\s,]+/).map(Number);
        if (w > 0 && h > 0) {
          svgSizeRef.current = { width: w, height: h };
          return;
        }
      }
      // Fallback to bounding rect
      const rect = svgEl.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        svgSizeRef.current = { width: rect.width, height: rect.height };
      }
    }, 100);
    return () => window.clearTimeout(timer);
  }, [svg, open]);

  const handleScaleChange = useCallback((value: number) => {
    const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
    setScale(clamped);
  }, []);

  const handleSliderChange = useCallback((values: number[]) => {
    handleScaleChange(values[0] ?? 1);
  }, [handleScaleChange]);

  const handleZoomIn = useCallback(() => {
    handleScaleChange(scale + SCALE_STEP);
  }, [scale, handleScaleChange]);

  const handleZoomOut = useCallback(() => {
    handleScaleChange(scale - SCALE_STEP);
  }, [scale, handleScaleChange]);

  // Pan handlers
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      setDragging(true);
      dragStart.current = {
        x: e.clientX,
        y: e.clientY,
        posX: position.x,
        posY: position.y,
      };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [position]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      const rawX = dragStart.current.posX + dx;
      const rawY = dragStart.current.posY + dy;

      // Clamp position so the image center stays within its own bounds.
      // This prevents the image from being dragged completely off-screen.
      const { width, height } = svgSizeRef.current;
      const maxX = (width * scale) / 2;
      const maxY = (height * scale) / 2;
      const margin = 60; // keep at least 60px of the image visible at edges
      setPosition({
        x: Math.max(-maxX + margin, Math.min(maxX - margin, rawX)),
        y: Math.max(-maxY + margin, Math.min(maxY - margin, rawY)),
      });
    },
    [dragging, scale]
  );

  const handlePointerUp = useCallback(() => {
    setDragging(false);
  }, []);

  function downloadPNG() {
    if (!svg) return;
    const exportSvg = getSvgExportSource(svg, containerRef.current);
    const blob = new Blob([exportSvg.source], {
      type: "image/svg+xml;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const img = new Image();

    img.onload = () => {
      const exportScale = Math.max(2, Math.min(window.devicePixelRatio || 2, 3));
      const w = img.naturalWidth || exportSvg.width;
      const h = img.naturalHeight || exportSvg.height;
      const canvas = document.createElement("canvas");
      canvas.width = w * exportScale;
      canvas.height = h * exportScale;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        return;
      }
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.scale(exportScale, exportScale);
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);

      canvas.toBlob((pngBlob) => {
        if (!pngBlob) return;
        const downloadUrl = URL.createObjectURL(pngBlob);
        const a = document.createElement("a");
        a.href = downloadUrl;
        a.download = `mermaid-${viewerId}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(downloadUrl);
      }, "image/png");
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      logger.error("SVG 加载失败", { context: "Mermaid Viewer PNG export" });
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
    a.download = `mermaid-${viewerId}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function copySourceCode() {
    try {
      await copyText(code);
      setCopiedSource(true);
      window.setTimeout(() => setCopiedSource(false), 1_500);
    } catch (err) {
      logger.error("Mermaid 查看器源码复制失败", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }



  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[92vw] sm:max-w-[90vw] h-[90vh] flex flex-col p-0 gap-0"
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">
          Mermaid 图表查看器
        </DialogTitle>

        {/* 工具栏 — pr-12 为右上角关闭按钮留出空间 */}
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--color-border-light)] px-4 py-2.5 pr-14">
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={handleZoomOut}
              disabled={scale <= MIN_SCALE}
              className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              aria-label="缩小"
            >
              <Minus size={14} strokeWidth={2} />
            </Button>

            <div className="flex w-32 items-center gap-2 px-1">
              <Slider
                value={[scale]}
                min={MIN_SCALE}
                max={MAX_SCALE}
                step={SCALE_STEP}
                onValueChange={handleSliderChange}
                aria-label="缩放比例"
              />
            </div>

            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={handleZoomIn}
              disabled={scale >= MAX_SCALE}
              className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              aria-label="放大"
            >
              <Plus size={14} strokeWidth={2} />
            </Button>

            <span className="ml-1 min-w-[3.5ch] text-xs tabular-nums text-[var(--color-text-tertiary)]">
              {Math.round(scale * 100)}%
            </span>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => { setScale(1); setPosition({ x: 0, y: 0 }); }}
            disabled={scale === 1 && position.x === 0 && position.y === 0}
            className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            aria-label="重置缩放和位置"
          >
            <Maximize size={14} strokeWidth={2} />
          </Button>

          <div className="ml-auto flex items-center gap-1">
            <Button
              type="button"
              onClick={copySourceCode}
              variant="ghost"
              size="sm"
              className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              aria-label={copiedSource ? "Mermaid 源码已复制" : "复制 Mermaid 源码"}
              title={copiedSource ? "Mermaid 源码已复制" : "复制 Mermaid 源码"}
            >
              {copiedSource ? (
                <Check size={14} strokeWidth={2} className="mr-1.5" />
              ) : (
                <Copy size={14} strokeWidth={2} className="mr-1.5" />
              )}
              源码
            </Button>
            <Button
              type="button"
              onClick={downloadPNG}
              variant="ghost"
              size="sm"
              className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            >
              <Download size={14} strokeWidth={2} className="mr-1.5" />
              PNG
            </Button>
            <Button
              type="button"
              onClick={downloadSVG}
              variant="ghost"
              size="sm"
              className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            >
              <Download size={14} strokeWidth={2} className="mr-1.5" />
              SVG
            </Button>
          </div>
        </div>

        {/* 图表区域 */}
        <div
          ref={svgWrapperRef}
          className="flex-1 min-h-0 overflow-hidden"
          style={{ cursor: dragging ? "grabbing" : "grab" }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          {svg ? (
            <div
              ref={containerRef}
              className="flex h-full w-full items-center justify-center p-4 [&_svg]:h-auto [&_svg]:max-w-none [&_svg]:min-h-[320px]"
              style={{
                transform: `scale(${scale}) translate(${position.x / scale}px, ${position.y / scale}px)`,
                transformOrigin: "center center",
                transition: dragging ? "none" : "transform 150ms ease-out",
              }}
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <span className="text-sm text-[var(--color-text-tertiary)]">
                渲染中...
              </span>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
