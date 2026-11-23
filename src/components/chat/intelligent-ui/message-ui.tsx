"use client";

import { lazy, memo, Suspense, useCallback, useEffect, useSyncExternalStore } from "react";
import { loadSurface, loadChart } from "./loaders";
import { UIRenderBoundary } from "./render-boundary";
import type { UINode, UISurface } from "@/lib/chat/intelligent-ui/catalog";
import type { ChatUIStream } from "@/lib/chat/intelligent-ui/client-state";

const Surface = lazy(loadSurface);
const containsChart = (node: UINode): boolean =>
  node.type === "bar" || node.type === "line" || Boolean(node.children?.some(containsChart));
const noop = () => {};

export const MessageUI = memo(function MessageUI({
  id, saved, stream, onDraft,
}: {
  id: string;
  saved?: UISurface;
  stream?: ChatUIStream;
  onDraft?: (text: string) => void;
}) {
  const subscribe = useCallback((listener: () => void) => stream?.subscribe(id, listener) ?? noop, [id, stream]);
  const get = useCallback(() => stream?.get(id) ?? saved, [id, saved, stream]);
  const getGeneration = useCallback(() => stream?.generation(id) ?? "archive", [stream, id]);
  const surface = useSyncExternalStore(subscribe, get, get);
  const generation = useSyncExternalStore(subscribe, getGeneration, getGeneration);
  useEffect(() => {
    if (surface?.groups.some(({ nodes }) => nodes.some(containsChart))) {
      void loadChart().catch(() => {});
    }
  }, [surface]);
  return surface ? (
    <div className="mt-3 min-w-0 max-w-full">
      <UIRenderBoundary key={generation}>
        <Suspense fallback={<p className="text-sm text-muted-foreground" role="status">正在加载交互内容…</p>}>
          <Surface surface={surface} onDraft={onDraft} />
        </Suspense>
      </UIRenderBoundary>
    </div>
  ) : null;
});
