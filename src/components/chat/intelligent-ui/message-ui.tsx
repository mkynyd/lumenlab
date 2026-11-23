"use client";

import { lazy, memo, Suspense, useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { loadSurface, loadChart } from "./loaders";
import { UIRenderBoundary } from "./render-boundary";
import type { UINode, UISurface } from "@/lib/chat/intelligent-ui/catalog";
import type { ChatUIStream } from "@/lib/chat/intelligent-ui/client-state";

type SurfaceComponent = Awaited<ReturnType<typeof loadSurface>>["default"];
const ArchivedSurface = lazy(loadSurface);
const loading = <p className="text-sm text-muted-foreground" role="status">正在加载交互内容…</p>;
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
  const [initiallyArchived] = useState(() => saved !== undefined);
  const [renderer, setRenderer] = useState<SurfaceComponent | "unavailable" | null>(null);
  const needsRenderer = !initiallyArchived && Boolean(surface) && renderer === null;
  useEffect(() => {
    if (!needsRenderer) return;
    let active = true;
    // Reveal a streamed preview as soon as its renderer arrives. Suspending
    // this external store update can hold the fallback past module readiness.
    void loadSurface().then(
      ({ default: Component }) => { if (active) setRenderer(() => Component); },
      () => { if (active) setRenderer("unavailable"); },
    );
    return () => { active = false; };
  }, [needsRenderer]);
  useEffect(() => {
    if (surface?.groups.some(({ nodes }) => nodes.some(containsChart))) {
      void loadChart().catch(() => {});
    }
  }, [surface]);
  if (!surface || renderer === "unavailable") return null;
  const Surface = renderer;
  return (
    <div className="mt-3 min-w-0 max-w-full">
      <UIRenderBoundary key={generation}>
        {initiallyArchived ? (
          <Suspense fallback={loading}>
            <ArchivedSurface surface={surface} onDraft={onDraft} />
          </Suspense>
        ) : Surface ? <Surface surface={surface} onDraft={onDraft} /> : loading}
      </UIRenderBoundary>
    </div>
  );
});
