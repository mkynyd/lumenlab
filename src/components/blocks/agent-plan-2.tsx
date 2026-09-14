/* eslint-disable react-hooks/refs -- ReactBits registry 演示源码，仅作设计参考保留原样 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Play, Plus, Square, Undo2, X } from "lucide-react";

const cx = (...c: (string | false | null | undefined)[]) =>
  c.filter(Boolean).join(" ");

type Item = {
  id: number;
  title: string;
  skipped: boolean;
};

const INITIAL: Item[] = [
  { id: 1, title: "Read the billing contract notes", skipped: false },
  { id: 2, title: "Map the entitlement resolver", skipped: false },
  { id: 3, title: "Patch the tier lookup fallback", skipped: false },
  { id: 4, title: "Add a renewal-grace regression test", skipped: false },
  { id: 5, title: "Run the license branch checks", skipped: false },
  { id: 6, title: "Regenerate the entitlement fixtures", skipped: true },
  { id: 7, title: "Update the installation docs", skipped: false },
  { id: 8, title: "Notify the reviewer channel", skipped: false },
  { id: 9, title: "Summarize the handoff for review", skipped: false },
];

const ICON_BUTTON =
  "inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-[var(--rb-r-sm,6px)] bg-neutral-100 text-neutral-600 transition-[transform,background-color,color] duration-100 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-neutral-200 hover:text-neutral-900 active:scale-[0.97] focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--rb-accent,oklch(20.5%_0_0))] disabled:pointer-events-none disabled:opacity-50 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-100 dark:focus-visible:outline-[var(--rb-accent,oklch(100%_0_0))]";

function useScrollFade<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    setEdges({
      start: scrollTop > 1,
      end: Math.ceil(scrollTop + clientHeight) < scrollHeight - 1,
    });
  }, []);

  useEffect(() => {
    update();
    const el = ref.current;
    const view = el?.ownerDocument.defaultView;
    if (!el || !view?.ResizeObserver) return;
    const observer = new view.ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [update]);

  return { ref, edges, onScroll: update };
}

export default function AgentPlan2() {
  const [items, setItems] = useState<Item[]>(INITIAL);
  const [draft, setDraft] = useState("");
  const [nextId, setNextId] = useState(10);
  const [running, setRunning] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  const list = useScrollFade<HTMLDivElement>();

  const listRef = useRef<HTMLOListElement>(null);
  const pendingFocus = useRef<{ id: number; dir: -1 | 1 } | null>(null);

  useEffect(() => {
    const pending = pendingFocus.current;
    const root = listRef.current;
    pendingFocus.current = null;
    if (!pending || !root) return;
    const pick = (dir: number) =>
      root.querySelector<HTMLButtonElement>(
        `[data-move="${pending.id}:${dir}"]`,
      );
    const preferred = pick(pending.dir);
    const target =
      preferred && !preferred.disabled ? preferred : pick(-pending.dir);
    target?.focus({ preventScroll: true });
  }, [items]);

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= items.length) return;
    const moved = items[index];
    pendingFocus.current = { id: moved.id, dir };
    setItems((prev) => {
      const next = prev.slice();
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setAnnouncement(
      `${moved.title} moved to position ${target + 1} of ${items.length}.`,
    );
  };

  const toggleSkip = (id: number) =>
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, skipped: !it.skipped } : it)),
    );

  const add = () => {
    const title = draft.trim();
    if (!title) return;
    setItems((prev) => [...prev, { id: nextId, title, skipped: false }]);
    setNextId((n) => n + 1);
    setDraft("");
    setAnnouncement(`${title} added to the end of the plan.`);
  };

  const active = items.filter((it) => !it.skipped).length;
  const skipped = items.length - active;

  return (
    <div className="relative flex h-full min-h-[640px] w-full flex-col overflow-hidden bg-white p-4 sm:p-6 dark:bg-neutral-950">
      <header className="mb-3 flex shrink-0 items-center gap-3">
        <h2 className="min-w-0 flex-1 truncate text-base font-medium tracking-[-0.01em] text-neutral-900 dark:text-neutral-100">
          Review the plan
        </h2>
        <span className="shrink-0 text-[13px] tabular-nums text-neutral-500 dark:text-neutral-400">
          {skipped > 0
            ? `${active} to run · ${skipped} skipped`
            : `${active} to run`}
        </span>
      </header>

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      <div className="flex min-h-0 flex-1 flex-col rounded-[var(--rb-r-2xl,14px)] border border-neutral-200/70 bg-neutral-50 p-1 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-[var(--rb-r-lg,10px)] border border-neutral-200/70 bg-white dark:border-neutral-800 dark:bg-neutral-950">
          <div
            ref={list.ref}
            onScroll={list.onScroll}
            className="h-full overflow-y-auto overscroll-contain p-2"
          >
            <ol ref={listRef} className="space-y-1">
              {items.map((item, index) => (
                <li
                  key={item.id}
                  className="flex h-11 items-center gap-2 rounded-[var(--rb-r-md,8px)] p-2 transition-colors duration-150 hover:bg-neutral-50 dark:hover:bg-neutral-900"
                >
                  <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--rb-r-sm,6px)] bg-neutral-100 text-xs tabular-nums text-neutral-500 dark:bg-neutral-800 dark:text-neutral-500">
                    {index + 1}
                  </span>
                  <span
                    className={cx(
                      "min-w-0 flex-1 truncate text-[13px]",
                      item.skipped
                        ? "text-neutral-400 line-through decoration-neutral-300 dark:text-neutral-600 dark:decoration-neutral-700"
                        : "font-medium text-neutral-900 dark:text-neutral-100",
                    )}
                  >
                    {item.title}
                    {item.skipped && <span className="sr-only">: skipped</span>}
                  </span>

                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      data-move={`${item.id}:-1`}
                      aria-label={`Move ${item.title} up`}
                      disabled={running || index === 0}
                      onClick={() => move(index, -1)}
                      className={ICON_BUTTON}
                    >
                      <ArrowUp aria-hidden="true" className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      data-move={`${item.id}:1`}
                      aria-label={`Move ${item.title} down`}
                      disabled={running || index === items.length - 1}
                      onClick={() => move(index, 1)}
                      className={ICON_BUTTON}
                    >
                      <ArrowDown aria-hidden="true" className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label={
                        item.skipped
                          ? `Restore ${item.title}`
                          : `Skip ${item.title}`
                      }
                      disabled={running}
                      onClick={() => toggleSkip(item.id)}
                      className={ICON_BUTTON}
                    >
                      {item.skipped ? (
                        <Undo2 aria-hidden="true" className="h-3.5 w-3.5" />
                      ) : (
                        <X aria-hidden="true" className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div
            aria-hidden="true"
            className={cx(
              "pointer-events-none absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-white to-transparent transition-opacity duration-200 ease-out dark:from-neutral-950",
              list.edges.start ? "opacity-100" : "opacity-0",
            )}
          />
          <div
            aria-hidden="true"
            className={cx(
              "pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-white to-transparent transition-opacity duration-200 ease-out dark:from-neutral-950",
              list.edges.end ? "opacity-100" : "opacity-0",
            )}
          />
        </div>
      </div>

      <div className="mt-3 flex shrink-0 items-center gap-2">
        <input
          value={draft}
          disabled={running}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
          placeholder="Add a step"
          aria-label="Add a step"
          className="h-9 min-w-0 flex-1 rounded-[var(--rb-r-md,8px)] border border-neutral-200 bg-white px-3 text-sm text-neutral-900 transition-colors duration-150 placeholder:text-neutral-400 hover:border-neutral-300 focus:border-neutral-900 focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rb-accent,oklch(20.5%_0_0))] disabled:pointer-events-none disabled:opacity-50 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:hover:border-neutral-700 dark:focus:border-white dark:focus-visible:outline-[var(--rb-accent,oklch(100%_0_0))]"
        />
        <button
          type="button"
          onClick={add}
          disabled={running || !draft.trim()}
          className="inline-flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-[var(--rb-r-md,8px)] bg-neutral-100 px-3 text-sm font-medium text-neutral-700 transition-[transform,background-color,color] duration-100 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-neutral-200 hover:text-neutral-900 active:scale-[0.97] focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rb-accent,oklch(20.5%_0_0))] disabled:pointer-events-none disabled:opacity-50 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700 dark:hover:text-neutral-100 dark:focus-visible:outline-[var(--rb-accent,oklch(100%_0_0))]"
        >
          <Plus aria-hidden="true" className="h-4 w-4 shrink-0" />
          Add
        </button>
      </div>

      <footer className="mt-3 flex shrink-0 items-center justify-end gap-3">
        <p className="hidden min-w-0 flex-1 truncate text-xs text-neutral-500 sm:block dark:text-neutral-500">
          {running
            ? "Running. Stop to keep editing the plan."
            : "Reorder or skip steps, then start the run."}
        </p>
        {running ? (
          <button
            type="button"
            onClick={() => setRunning(false)}
            className="inline-flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-[var(--rb-r-md,8px)] bg-neutral-100 px-3 text-sm font-medium text-neutral-700 transition-[transform,background-color,color] duration-100 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-neutral-200 hover:text-neutral-900 active:scale-[0.97] focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rb-accent,oklch(20.5%_0_0))] dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700 dark:hover:text-neutral-100 dark:focus-visible:outline-[var(--rb-accent,oklch(100%_0_0))]"
          >
            <Square
              aria-hidden="true"
              className="h-4 w-4 shrink-0 fill-current"
            />
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setRunning(true)}
            disabled={active === 0}
            className="inline-flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-[var(--rb-r-md,8px)] bg-[var(--rb-accent,oklch(20.5%_0_0))] px-3 text-sm font-medium text-[var(--rb-accent-fg,oklch(100%_0_0))] transition-[transform,background-color] duration-100 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-[color-mix(in_oklab,var(--rb-accent,oklch(20.5%_0_0))_90%,transparent)] active:scale-[0.97] focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rb-accent,oklch(20.5%_0_0))] disabled:pointer-events-none disabled:opacity-50 dark:bg-[var(--rb-accent,oklch(100%_0_0))] dark:text-[var(--rb-accent-fg,oklch(20.5%_0_0))] dark:hover:bg-[color-mix(in_oklab,var(--rb-accent,oklch(100%_0_0))_90%,transparent)] dark:focus-visible:outline-[var(--rb-accent,oklch(100%_0_0))]"
          >
            <Play aria-hidden="true" className="h-4 w-4 shrink-0" />
            Start {active} step{active === 1 ? "" : "s"}
          </button>
        )}
      </footer>
    </div>
  );
}
