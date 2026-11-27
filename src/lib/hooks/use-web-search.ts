"use client";
import { useState, useCallback } from "react";

export function useWebSearch() {
  // 默认开放联网能力：是否真正检索由模型按问题判断，用户仍可在加号面板关闭。
  const [webSearchActive, setWebSearchActive] = useState(true);
  const toggle = useCallback(() => setWebSearchActive((p) => !p), []);
  return { webSearchActive, toggle };
}
