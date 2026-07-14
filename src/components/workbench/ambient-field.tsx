"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export function shouldContinueAmbientFrame(
  pulseStartedAt: number,
  now: number,
  reducedMotion: boolean
) {
  return !reducedMotion && pulseStartedAt > 0 && now - pulseStartedAt < 640;
}

interface DotPosition {
  x: number;
  y: number;
}

interface ObstacleRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const OBSTACLE_CONTENT_PADDING = 8;
const OBSTACLE_FADE_DISTANCE = 88;
const OBSTACLE_MIN_FADE = 0.14;

function distanceFromRect(dot: DotPosition, rect: ObstacleRect) {
  const nearestX = Math.max(rect.left, Math.min(dot.x, rect.right));
  const nearestY = Math.max(rect.top, Math.min(dot.y, rect.bottom));
  return Math.hypot(dot.x - nearestX, dot.y - nearestY);
}

export function getDotObstacleFade(
  dot: DotPosition,
  obstacles: ObstacleRect[],
  fadeDistance = OBSTACLE_FADE_DISTANCE
) {
  if (obstacles.length === 0) return 1;

  let nearestDistance = Infinity;
  for (const rect of obstacles) {
    nearestDistance = Math.min(nearestDistance, distanceFromRect(dot, rect));
  }

  if (nearestDistance >= fadeDistance) return 1;
  const t = Math.max(0, nearestDistance / fadeDistance);
  const eased = t * t * (3 - 2 * t);
  return OBSTACLE_MIN_FADE + eased * (1 - OBSTACLE_MIN_FADE);
}

interface AmbientFieldProps {
  intensity?: "low" | "medium";
  density?: "auto" | "compact" | "wide";
  className?: string;
}

export function AmbientField({
  intensity = "low",
  density = "auto",
  className,
}: AmbientFieldProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!wrapperRef.current || !canvasRef.current) return;
    const wrapperEl = wrapperRef.current;
    const canvasEl = canvasRef.current;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    const pointer = {
      x: -1000,
      y: -1000,
      pulseX: -1000,
      pulseY: -1000,
      pulseStartedAt: 0,
    };
    let rafId = 0;
    let pointerInputEnabled = false;
    let dots: DotPosition[] = [];
    let width = 0;
    let height = 0;
    let dotSize = 2.2;
    let gap = 30;
    const drawingContext = canvasEl.getContext("2d");
    if (!drawingContext) return;
    const ctx: CanvasRenderingContext2D = drawingContext;

    function readThemeColor(name: string) {
      return getComputedStyle(document.documentElement)
        .getPropertyValue(name)
        .trim();
    }

    function resolveDensity(nextWidth: number) {
      const compact = density === "compact" || nextWidth < 560;
      const wide = density === "wide" || nextWidth > 1200;
      if (compact) return { dotSize: 1.7, gap: 28, proximity: 92 };
      if (wide) return { dotSize: 2.1, gap: 46, proximity: 150 };
      return { dotSize: 1.9, gap: 36, proximity: 125 };
    }

    let proximity = 125;
    let obstacles: ObstacleRect[] = [];

    function refreshObstacles() {
      const wrapperRect = wrapperEl.getBoundingClientRect();
      const scopeEl = wrapperEl.parentElement ?? wrapperEl;
      obstacles = Array.from(scopeEl.querySelectorAll("[data-dot-avoid]")).map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          left: rect.left - wrapperRect.left - OBSTACLE_CONTENT_PADDING,
          top: rect.top - wrapperRect.top - OBSTACLE_CONTENT_PADDING,
          right: rect.right - wrapperRect.left + OBSTACLE_CONTENT_PADDING,
          bottom: rect.bottom - wrapperRect.top + OBSTACLE_CONTENT_PADDING,
        };
      });
    }

    function buildGrid() {
      const rect = wrapperEl.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      width = rect.width;
      height = rect.height;
      const next = resolveDensity(width);
      dotSize = next.dotSize;
      gap = next.gap;
      proximity = next.proximity;

      canvasEl.width = Math.max(1, Math.floor(width * dpr));
      canvasEl.height = Math.max(1, Math.floor(height * dpr));
      canvasEl.style.width = `${width}px`;
      canvasEl.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      dots = [];
      const step = gap + dotSize;
      const cols = Math.ceil(width / step) + 2;
      const rows = Math.ceil(height / step) + 2;
      const offsetX = (width - (cols - 1) * step) / 2;
      const offsetY = (height - (rows - 1) * step) / 2;
      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          dots.push({
            x: offsetX + col * step,
            y: offsetY + row * step,
          });
        }
      }
      refreshObstacles();
    }

    function draw() {
      const baseColor = readThemeColor("--dot-grid-base") || "rgba(100,116,139,0.16)";
      const activeColor = readThemeColor("--dot-grid-active") || "rgba(37,99,235,0.7)";
      const now = performance.now();
      const pointerFeedbackEnabled = finePointer.matches && !reducedMotion.matches;
      ctx.clearRect(0, 0, width, height);

      for (const dot of dots) {
        const drawX = dot.x;
        const drawY = dot.y;
        const dx = drawX - pointer.x;
        const dy = drawY - pointer.y;
        const distance = pointerFeedbackEnabled ? Math.hypot(dx, dy) : Infinity;
        const t = Math.max(0, 1 - distance / proximity);
        const pulseAge = now - pointer.pulseStartedAt;
        const pulseDistance = Math.hypot(drawX - pointer.pulseX, drawY - pointer.pulseY);
        const pulse = pointerFeedbackEnabled && pulseAge < 640
          ? Math.max(0, 1 - pulseAge / 640) * Math.max(0, 1 - pulseDistance / 220)
          : 0;
        const strength = Math.min(1, t + pulse * 0.8);
        const obstacleFade = getDotObstacleFade(dot, obstacles);
        const effectiveStrength = strength * obstacleFade;

        ctx.globalAlpha =
          (0.6 + effectiveStrength * (intensity === "medium" ? 0.4 : 0.28)) *
          obstacleFade;
        ctx.fillStyle = effectiveStrength > 0.04 ? activeColor : baseColor;
        ctx.beginPath();
        ctx.arc(drawX, drawY, dotSize + effectiveStrength * 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      const continueFrame = shouldContinueAmbientFrame(
        pointer.pulseStartedAt,
        now,
        !pointerFeedbackEnabled
      );
      if (continueFrame) {
        rafId = window.requestAnimationFrame(draw);
      }
    }

    function handlePointerMove(event: PointerEvent) {
      if (!pointerInputEnabled) return;
      const rect = canvasEl.getBoundingClientRect();
      pointer.x = event.clientX - rect.left;
      pointer.y = event.clientY - rect.top;
      window.cancelAnimationFrame(rafId);
      rafId = window.requestAnimationFrame(draw);
    }

    function handlePointerDown(event: PointerEvent) {
      if (!pointerInputEnabled) return;
      const rect = canvasEl.getBoundingClientRect();
      pointer.pulseX = event.clientX - rect.left;
      pointer.pulseY = event.clientY - rect.top;
      pointer.pulseStartedAt = performance.now();
      window.cancelAnimationFrame(rafId);
      rafId = window.requestAnimationFrame(draw);
    }

    function syncPointerInput() {
      const nextEnabled = finePointer.matches && !reducedMotion.matches;
      if (nextEnabled === pointerInputEnabled) return;
      pointerInputEnabled = nextEnabled;

      if (nextEnabled) {
        window.addEventListener("pointermove", handlePointerMove, { passive: true });
        window.addEventListener("pointerdown", handlePointerDown, { passive: true });
      } else {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerdown", handlePointerDown);
        pointer.x = -1000;
        pointer.y = -1000;
        pointer.pulseStartedAt = 0;
        window.cancelAnimationFrame(rafId);
        draw();
      }
    }

    buildGrid();
    draw();
    const observer = new ResizeObserver(() => {
      buildGrid();
      draw();
    });
    const themeObserver = new MutationObserver(draw);
    const obstacleObserver = new MutationObserver(() => {
      refreshObstacles();
      draw();
    });
    observer.observe(wrapperEl);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    obstacleObserver.observe(wrapperEl, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-dot-avoid"],
    });
    reducedMotion.addEventListener("change", syncPointerInput);
    finePointer.addEventListener("change", syncPointerInput);
    syncPointerInput();

    return () => {
      observer.disconnect();
      themeObserver.disconnect();
      obstacleObserver.disconnect();
      window.cancelAnimationFrame(rafId);
      reducedMotion.removeEventListener("change", syncPointerInput);
      finePointer.removeEventListener("change", syncPointerInput);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [density, intensity]);

  return (
    <div
      ref={wrapperRef}
      aria-hidden="true"
      className={cn(
        "workbench-ambient",
        intensity === "medium" && "workbench-ambient-medium",
        className
      )}
    >
      <canvas ref={canvasRef} className="workbench-ambient-canvas" />
    </div>
  );
}
