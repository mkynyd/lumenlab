/* eslint-disable react-hooks/refs, react-hooks/exhaustive-deps -- ReactBits registry 演示源码，仅作设计参考保留原样 */
"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowDown, ArrowUp, Plus, Square } from "lucide-react";

const cx = (...c: (string | false | null | undefined)[]) =>
  c.filter(Boolean).join(" ");

type Message = {
  id: string;
  role: "user" | "assistant";
  agent?: string;
  handoff?: boolean;
  text: string;
};

const CATCH_UP_MS = 180;
const FLOOR_CPS = 45;

function lastWordBoundary(source: string, cut: number) {
  if (cut >= source.length) return source.length;
  const i = source.lastIndexOf(" ", cut);
  return i === -1 ? 0 : i;
}

function useSmoothedText() {
  const [text, setText] = useState("");
  const [done, setDone] = useState(false);
  const targetRef = useRef("");
  const shownRef = useRef(0);
  const endedRef = useRef(false);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(now - last, 64);
      last = now;
      const target = targetRef.current;
      const behind = target.length - shownRef.current;
      if (behind > 0) {
        shownRef.current = reduceMotion
          ? target.length
          : Math.min(
              target.length,
              shownRef.current +
                behind * (1 - Math.exp(-dt / CATCH_UP_MS)) +
                (FLOOR_CPS * dt) / 1000,
            );
        const cut = Math.floor(shownRef.current);
        const finished = endedRef.current && cut >= target.length;
        const safe = finished ? target.length : lastWordBoundary(target, cut);
        setText(target.slice(0, safe));
        if (finished) setDone(true);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduceMotion]);

  const push = useCallback((chunk: string) => {
    targetRef.current += chunk;
  }, []);
  const end = useCallback(() => {
    endedRef.current = true;
  }, []);
  const reset = useCallback(() => {
    targetRef.current = "";
    shownRef.current = 0;
    endedRef.current = false;
    setText("");
    setDone(false);
  }, []);
  return { text, done, push, end, reset };
}

function StreamingWords({ text }: { text: string }) {
  const reduced = useReducedMotion();
  if (reduced) return <>{text}</>;
  const words = text.match(/\S+\s*/g) ?? [];
  return (
    <>
      {words.map((word, i) => (
        <motion.span
          key={i}
          initial={{ opacity: 0, filter: "blur(4px)" }}
          animate={{ opacity: 1, filter: "blur(0px)" }}
          transition={{ duration: 0.24, ease: [0.23, 1, 0.32, 1] }}
          className="inline-block whitespace-pre-wrap"
        >
          {word}
        </motion.span>
      ))}
    </>
  );
}

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

function useStickToBottom(scrollRef: RefObject<HTMLDivElement | null>) {
  const stickRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const sync = () => {
      const overflowing = el.scrollHeight - el.clientHeight > 1;
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      const atBottom = !overflowing || distance < 24;
      stickRef.current = atBottom;
      setShowJump(overflowing && !atBottom);
    };

    const onIntent = (e: WheelEvent | TouchEvent) => {
      const up = "deltaY" in e ? e.deltaY < 0 : true;
      if (!up) return;
      if (el.scrollHeight - el.clientHeight > 1 && el.scrollTop > 0) {
        stickRef.current = false;
      }
    };

    const observer = new ResizeObserver(() => {
      if (stickRef.current) el.scrollTop = el.scrollHeight;
      sync();
    });
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);

    el.addEventListener("wheel", onIntent, { passive: true });
    el.addEventListener("touchmove", onIntent, { passive: true });
    el.addEventListener("scroll", sync, { passive: true });

    el.scrollTop = el.scrollHeight;
    sync();
    return () => {
      observer.disconnect();
      el.removeEventListener("wheel", onIntent);
      el.removeEventListener("touchmove", onIntent);
      el.removeEventListener("scroll", sync);
    };
  }, []);

  const jumpToLatest = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = true;
    setShowJump(false);
    el.scrollTop = el.scrollHeight;
  }, []);

  return { showJump, jumpToLatest };
}

const STREAM_TARGET =
  "For a small team that puts privacy first, the encrypted app is the pick. It " +
  "runs a dollar or two more per seat, but it is the only one that keeps notes " +
  "end-to-end encrypted, and the price gap barely registers under ten seats.";

const LIVE_ID = "writer-2";

const INITIAL_MESSAGES: Message[] = [
  {
    id: "u1",
    role: "user",
    text: "Put together a competitive brief on the top three note-taking apps.",
  },
  {
    id: "planner-1",
    role: "assistant",
    agent: "Planner",
    handoff: true,
    text: "I'll split this into two parts. Researcher will gather pricing and the core feature set for each app, then Writer will turn that into a one-page brief.",
  },
  {
    id: "researcher-1",
    role: "assistant",
    agent: "Researcher",
    handoff: true,
    text: "All three offer a free tier. Paid plans are $8, $10, and $12 per seat each month. The clearest differences are offline sync and end-to-end encryption, which only one app includes.",
  },
  {
    id: "u2",
    role: "user",
    text: "Which one fits a small, privacy-focused team best?",
  },
  {
    id: LIVE_ID,
    role: "assistant",
    agent: "Writer",
    handoff: true,
    text: STREAM_TARGET,
  },
];

const ACTIVITY = [
  {
    agent: "Planner",
    detail: "Split the task into research + writing",
    status: "done",
  },
  { agent: "Researcher", detail: "Pulled pricing for 3 apps", status: "done" },
  {
    agent: "Researcher",
    detail: "Compared offline-sync support",
    status: "done",
  },
  {
    agent: "Researcher",
    detail: "Checked encryption coverage",
    status: "done",
  },
  { agent: "Researcher", detail: "Noted free-tier limits", status: "done" },
  { agent: "Writer", detail: "Outlined the one-page brief", status: "done" },
  { agent: "Writer", detail: "Drafted the comparison", status: "done" },
  {
    agent: "Researcher",
    detail: "Summarized review sentiment",
    status: "done",
  },
  { agent: "Planner", detail: "Flagged the price trade-off", status: "done" },
  { agent: "Planner", detail: "Reviewed for a privacy angle", status: "done" },
  { agent: "Writer", detail: "Recommending an option", status: "running" },
] as const;

export default function AiChat6() {
  const reduced = useReducedMotion();
  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES);
  const [stopped, setStopped] = useState(false);
  const [value, setValue] = useState("");
  const [runId, setRunId] = useState(0);

  const { text: streamText, done, push, end, reset } = useSmoothedText();
  const transcript = useScrollFade<HTMLDivElement>();
  const activity = useScrollFade<HTMLDivElement>();
  const { showJump, jumpToLatest } = useStickToBottom(transcript.ref);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const transportRef = useRef<number | null>(null);

  const streaming = !done && !stopped;

  useEffect(() => {
    if (reduced) {
      push(STREAM_TARGET);
      end();
      return;
    }
    const chunks = STREAM_TARGET.match(/\S+\s*/g) ?? [];
    let i = 0;
    transportRef.current = window.setInterval(() => {
      const n = 1 + Math.floor(Math.random() * 3);
      push(chunks.slice(i, i + n).join(""));
      i += n;
      if (i >= chunks.length) {
        end();
        if (transportRef.current) window.clearInterval(transportRef.current);
        transportRef.current = null;
      }
    }, 130);
    return () => {
      if (transportRef.current) window.clearInterval(transportRef.current);
    };
  }, [reduced, push, end, runId]);

  const autosize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  const handleSend = useCallback((text: string) => {
    const t = text.trim();
    if (!t) return;
    setMessages((m) => [
      ...m,
      { id: `u-${Date.now()}`, role: "user", text: t },
    ]);
    setValue("");
  }, []);

  const handleStop = useCallback(() => {
    if (transportRef.current) {
      window.clearInterval(transportRef.current);
      transportRef.current = null;
    }
    end();
    setStopped(true);
  }, [end]);

  const handleRegenerate = useCallback(() => {
    reset();
    setStopped(false);
    setRunId((n) => n + 1);
  }, [reset]);

  return (
    <div className="relative flex h-full min-h-[640px] w-full min-w-0 flex-col overflow-hidden bg-white lg:flex-row dark:bg-neutral-950">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="shrink-0">
          <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between gap-3 px-4 sm:px-6">
            <h1 className="text-base font-medium tracking-[-0.01em] text-neutral-900 dark:text-neutral-100">
              Competitive brief
            </h1>
            <span className="text-[13px] text-neutral-500">
              Planner · 3 agents
            </span>
          </div>
        </header>

        <div className="relative flex min-h-0 flex-1 flex-col">
          <div
            ref={transcript.ref}
            onScroll={transcript.onScroll}
            className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col overflow-y-auto overscroll-contain [overflow-anchor:none]"
          >
            <div className="mt-auto flex w-full flex-col gap-6 px-4 py-6 sm:px-6">
              {messages.map((message) => {
                if (message.role === "user") {
                  return (
                    <div key={message.id} className="flex">
                      <div className="ml-auto max-w-[85%] rounded-[var(--rb-r-2xl,14px)] bg-neutral-100 px-3.5 py-2.5 text-sm leading-6 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100">
                        {message.text}
                      </div>
                    </div>
                  );
                }
                const live = message.id === LIVE_ID && streaming;
                const settled = message.id === LIVE_ID && !streaming;
                return (
                  <div key={message.id}>
                    {message.handoff && (
                      <span className="inline-flex h-6 items-center rounded-[var(--rb-r-sm,6px)] bg-neutral-100 px-2 text-[11px] font-medium uppercase tracking-[0.06em] text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                        {message.agent}
                      </span>
                    )}
                    <p className="mt-2.5 max-w-prose text-sm leading-relaxed text-neutral-900 dark:text-neutral-100">
                      {live ? (
                        <StreamingWords text={streamText} />
                      ) : (
                        message.text
                      )}
                    </p>
                    {settled && (
                      <button
                        type="button"
                        onClick={handleRegenerate}
                        className="cursor-pointer mt-3 inline-flex h-8 items-center gap-1.5 rounded-[var(--rb-r-md,8px)] bg-neutral-100 px-2.5 text-[13px] font-medium text-neutral-700 transition-[transform,background-color,color] duration-100 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-neutral-200 hover:text-neutral-700 active:scale-[0.97] focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rb-accent,oklch(20.5%_0_0))] dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700 dark:hover:text-neutral-100 dark:focus-visible:outline-[var(--rb-accent,oklch(100%_0_0))]"
                      >
                        Regenerate
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div
            aria-hidden="true"
            className={cx(
              "pointer-events-none absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-white to-transparent transition-opacity duration-200 ease-out dark:from-neutral-950",
              transcript.edges.start ? "opacity-100" : "opacity-0",
            )}
          />
          <div
            aria-hidden="true"
            className={cx(
              "pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-white to-transparent transition-opacity duration-200 ease-out dark:from-neutral-950",
              transcript.edges.end ? "opacity-100" : "opacity-0",
            )}
          />

          {showJump && (
            <motion.button
              type="button"
              onClick={jumpToLatest}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.15 }}
              className="cursor-pointer absolute bottom-3 left-1/2 z-10 inline-flex h-8 -translate-x-1/2 items-center gap-1.5 rounded-[var(--rb-r-md,8px)] border border-neutral-200/70 bg-white px-3 text-[13px] font-medium text-neutral-700 shadow-[0_4px_16px_-4px_rgba(0,0,0,0.10)] transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rb-accent,oklch(20.5%_0_0))] dark:border-neutral-800 dark:bg-neutral-800 dark:text-neutral-200 dark:shadow-none dark:hover:bg-neutral-700 dark:focus-visible:outline-[var(--rb-accent,oklch(100%_0_0))]"
            >
              <ArrowDown className="h-3.5 w-3.5 shrink-0" />
              Jump to latest
            </motion.button>
          )}
        </div>

        <div className="shrink-0">
          <div className="mx-auto w-full max-w-3xl px-4 pb-4 sm:px-6">
            <div className="rounded-[var(--rb-r-2xl,14px)] border border-neutral-200 bg-white transition-colors focus-within:border-neutral-300 dark:border-neutral-800 dark:bg-neutral-900 dark:focus-within:border-neutral-700">
              <textarea
                ref={textareaRef}
                rows={1}
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  autosize();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend(value);
                  }
                }}
                placeholder="Ask anything"
                className="block max-h-40 w-full resize-none bg-transparent px-3 pt-3 text-sm leading-6 text-neutral-900 outline-none placeholder:text-neutral-500 dark:text-neutral-100"
              />
              <div className="flex items-center gap-1 px-3 pb-3 pt-1">
                <button
                  type="button"
                  aria-label="Add attachment"
                  className="cursor-pointer inline-flex h-8 w-8 items-center justify-center rounded-[var(--rb-r-md,8px)] bg-neutral-100 text-neutral-500 transition-[transform,background-color,color] duration-100 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-neutral-200 hover:text-neutral-700 active:scale-[0.97] focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rb-accent,oklch(20.5%_0_0))] dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700 dark:hover:text-neutral-100 dark:focus-visible:outline-[var(--rb-accent,oklch(100%_0_0))]"
                >
                  <Plus className="h-4 w-4 shrink-0" />
                </button>
                <div className="ml-auto flex items-center gap-1">
                  {streaming ? (
                    <button
                      type="button"
                      onClick={handleStop}
                      key="stop"
                      aria-label="Stop generating"
                      className="cursor-pointer inline-flex h-8 w-8 items-center justify-center rounded-[var(--rb-r-md,8px)] bg-[var(--rb-accent,oklch(20.5%_0_0))] text-[var(--rb-accent-fg,oklch(100%_0_0))] transition-[transform,background-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-[color-mix(in_oklab,var(--rb-accent,oklch(20.5%_0_0))_90%,transparent)] active:scale-95 focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rb-accent,oklch(20.5%_0_0))] dark:bg-[var(--rb-accent,oklch(100%_0_0))] dark:text-[var(--rb-accent-fg,oklch(20.5%_0_0))] dark:focus-visible:outline-[var(--rb-accent,oklch(100%_0_0))]"
                    >
                      <Square className="h-3.5 w-3.5 shrink-0" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleSend(value)}
                      key="send"
                      aria-label="Send"
                      disabled={value.trim().length === 0}
                      className="cursor-pointer inline-flex h-8 w-8 items-center justify-center rounded-[var(--rb-r-md,8px)] bg-[var(--rb-accent,oklch(20.5%_0_0))] text-[var(--rb-accent-fg,oklch(100%_0_0))] transition-[transform,background-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-[color-mix(in_oklab,var(--rb-accent,oklch(20.5%_0_0))_90%,transparent)] active:scale-95 focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rb-accent,oklch(20.5%_0_0))] disabled:bg-neutral-200 disabled:text-neutral-400 dark:bg-[var(--rb-accent,oklch(100%_0_0))] dark:text-[var(--rb-accent-fg,oklch(20.5%_0_0))] dark:focus-visible:outline-[var(--rb-accent,oklch(100%_0_0))] dark:disabled:bg-neutral-700"
                    >
                      <ArrowUp className="h-4 w-4 shrink-0" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <aside className="hidden shrink-0 flex-col bg-white p-4 lg:flex lg:w-80 dark:bg-neutral-950">
        <h2 className="mb-2 px-1 text-[13px] font-medium text-neutral-900 dark:text-neutral-100">
          Activity
        </h2>
        <div className="flex min-h-0 flex-1 flex-col rounded-[var(--rb-r-2xl,14px)] border border-neutral-200/70 bg-neutral-50 p-1 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="relative min-h-0 flex-1 overflow-hidden rounded-[var(--rb-r-lg,10px)] border border-neutral-200/70 bg-white dark:border-neutral-800 dark:bg-neutral-950">
            <div
              ref={activity.ref}
              onScroll={activity.onScroll}
              className="h-full overflow-y-auto p-3"
            >
              <ol className="relative">
                <div className="absolute bottom-2 left-[3px] top-2 w-px bg-neutral-200 dark:bg-neutral-800" />
                {ACTIVITY.map((item, i) => {
                  const live =
                    item.status === "running" && i === ACTIVITY.length - 1;
                  const running = live && streaming;
                  const label = running
                    ? "Running"
                    : live && stopped
                      ? "Stopped"
                      : "Done";
                  return (
                    <li
                      key={`${item.agent}-${i}`}
                      className="relative flex gap-3 pb-4 last:pb-0"
                    >
                      <span
                        className={cx(
                          "relative z-10 mt-1 h-1.5 w-1.5 shrink-0 rounded-full",
                          running
                            ? "bg-neutral-400 dark:bg-neutral-500 animate-pulse motion-reduce:animate-none"
                            : "bg-neutral-300 dark:bg-neutral-600",
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-[13px] font-medium text-neutral-900 dark:text-neutral-100">
                            {item.agent}
                          </span>
                          <span className="ml-auto min-w-14 shrink-0 text-right text-xs text-neutral-500">
                            {label}
                          </span>
                        </div>
                        <p className="truncate text-xs text-neutral-500">
                          {item.detail}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>

            <div
              aria-hidden="true"
              className={cx(
                "pointer-events-none absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-white to-transparent transition-opacity duration-200 ease-out dark:from-neutral-950",
                activity.edges.start ? "opacity-100" : "opacity-0",
              )}
            />
            <div
              aria-hidden="true"
              className={cx(
                "pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-white to-transparent transition-opacity duration-200 ease-out dark:from-neutral-950",
                activity.edges.end ? "opacity-100" : "opacity-0",
              )}
            />
          </div>
        </div>
      </aside>
    </div>
  );
}
