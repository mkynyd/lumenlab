"use client";

import { useEffect, useState } from "react";
import { DEFAULT_CHAT_MODELS } from "@/lib/chat/model-catalog";

/**
 * 服务端模型目录（/api/chat/models）：Qwen 灰度等可用性由服务端下发。
 * 与 use-chat 内联目录请求保持同一数据源；失败时回退到本地活跃模型列表。
 */
export function useAvailableChatModels() {
  const [availableModels, setAvailableModels] = useState<readonly string[] | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/chat/models", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`model catalog ${response.status}`);
        const payload = (await response.json()) as { models?: unknown };
        if (!Array.isArray(payload.models) || !payload.models.every((model) => typeof model === "string")) {
          throw new Error("invalid model catalog");
        }
        setAvailableModels(payload.models as string[]);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.warn("Failed to load chat model catalog", error);
        setAvailableModels(DEFAULT_CHAT_MODELS);
        setCatalogError("无法检查模型可用性，当前选择已保留");
      });
    return () => controller.abort();
  }, []);

  return { availableModels, catalogError };
}
