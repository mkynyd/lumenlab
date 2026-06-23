"use client";

import { useSyncExternalStore } from "react";

/**
 * 订阅 prefers-reduced-motion 媒体查询。
 * 用 useSyncExternalStore 而非 useEffect + setState，
 * 避免 React 19 的 cascading-renders 警告，同时正确处理 SSR/CSR 状态差。
 */

function subscribe(notify: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) {
    return () => {};
  }
  const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
  mql.addEventListener("change", notify);
  return () => mql.removeEventListener("change", notify);
}

function getSnapshot(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function getServerSnapshot(): boolean {
  return false;
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
