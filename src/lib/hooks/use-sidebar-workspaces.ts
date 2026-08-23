"use client";

import { useEffect, useState } from "react";
import type { PaperWorkspaceSummary, ResearchWorkspaceSummary } from "@/lib/api/types";

function useSidebarList<T>(url: string) {
  const [data, setData] = useState<T[]>([]);
  const [isPending, setIsPending] = useState(true);

  useEffect(() => {
    let active = true;
    void fetch(url)
      .then(async (response) => (response.ok ? (await response.json()) as { workspaces?: T[] } : { workspaces: [] }))
      .then((payload) => {
        if (!active) return;
        setData(payload.workspaces ?? []);
        setIsPending(false);
      })
      .catch(() => {
        if (active) setIsPending(false);
      });
    return () => {
      active = false;
    };
  }, [url]);

  return { data, isPending };
}

export function useSidebarResearchWorkspaces() {
  return useSidebarList<ResearchWorkspaceSummary>("/api/research/workspaces");
}

export function useSidebarPaperWorkspaces() {
  return useSidebarList<PaperWorkspaceSummary>("/api/papers/workspaces");
}
