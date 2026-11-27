import { useEffect, useRef, useState } from "react";
import { measureText, loadFontForOptions } from "@/lib/text-layout";

interface UseMeasuredTextareaHeightOptions {
  value: string;
  minHeight?: number;
  maxHeight?: number;
  fontSize?: number;
  lineHeight?: number;
  fontFamily?: string;
  paddingX?: number;
  paddingY?: number;
}

/**
 * Hook that computes a textarea's height using Pretext instead of DOM
 * scrollHeight reads. This avoids a layout reflow on every keystroke.
 */
export function useMeasuredTextareaHeight({
  value,
  minHeight = 36,
  maxHeight = 128,
  fontSize = 14,
  lineHeight = 20,
  fontFamily = '"Noto Sans SC"',
  paddingX = 16,
  paddingY = 16,
}: UseMeasuredTextareaHeightOptions) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [width, setWidth] = useState(0);
  const [fontsReady, setFontsReady] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const update = () => setWidth(el.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    loadFontForOptions({ fontSize, fontFamily }).then(() =>
      setFontsReady(true)
    );
  }, [fontSize, fontFamily]);

  const measuredHeight = (() => {
    if (width === 0 || !fontsReady) return minHeight;
    const { height } = measureText(value || "", {
      maxWidth: Math.max(0, width - paddingX),
      fontSize,
      lineHeight,
      fontFamily,
      whiteSpace: "pre-wrap",
    });
    return Math.min(maxHeight, Math.max(minHeight, height + paddingY));
  })();

  return {
    ref,
    height: measuredHeight,
    style: {
      height: measuredHeight,
      overflowX: "hidden" as const,
      overflowY: measuredHeight >= maxHeight ? ("auto" as const) : ("hidden" as const),
    },
  };
}
