"use client";

import { useState, useCallback } from "react";

/**
 * Per-conversation web search toggle state.
 * Default: off. Toggle persists within the current conversation session only.
 */
export function useWebSearch() {
  const [webSearchActive, setWebSearchActive] = useState(false);

  const toggle = useCallback(() => {
    setWebSearchActive((prev) => !prev);
  }, []);

  const setActive = useCallback((active: boolean) => {
    setWebSearchActive(active);
  }, []);

  return { webSearchActive, toggle, setActive };
}
