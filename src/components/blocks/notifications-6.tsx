"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  AtSign,
  Bell,
  CheckCheck,
  GitPullRequest,
  MessageSquare,
  Settings,
  ShieldCheck,
} from "lucide-react";

const cx = (...c: (string | false | null | undefined)[]) =>
  c.filter(Boolean).join(" ");

const focus =
  "focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--rb-accent,oklch(20.5%_0_0))] dark:focus-visible:outline-[var(--rb-accent,oklch(100%_0_0))]";

const transition =
  "transition-[background-color,border-color,color,opacity,transform] duration-150 ease-out";

const TABS = ["All", "Unread"] as const;
type Tab = (typeof TABS)[number];

type Item = {
  id: string;
  icon: typeof Bell;
  actor: string;
  action: string;
  time: string;
  unread: boolean;
};

const SEED: Item[] = [
  {
    id: "p1",
    icon: AtSign,
    actor: "Ana Reyes",
    action: "mentioned you in Q3 rollout plan",
    time: "12m",
    unread: true,
  },
  {
    id: "p2",
    icon: GitPullRequest,
    actor: "Wei Chen",
    action: "requested review on Billing usage meter",
    time: "48m",
    unread: true,
  },
  {
    id: "p3",
    icon: ShieldCheck,
    actor: "Halcyon",
    action: "recorded a sign-in from macOS · Lisbon",
    time: "3h",
    unread: true,
  },
  {
    id: "p4",
    icon: MessageSquare,
    actor: "Marco Silva",
    action: "replied in Onboarding checklist",
    time: "5h",
    unread: false,
  },
  {
    id: "p5",
    icon: MessageSquare,
    actor: "Sofia Alvarez",
    action: "resolved your comment in Meridian import",
    time: "1d",
    unread: false,
  },
];

const NAV = ["Overview", "Projects", "Reports"];

export default function Notifications6() {
  const uid = useId();
  const reduce = useReducedMotion();
  const [items, setItems] = useState<Item[]>(SEED);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("All");
  const wrapRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLButtonElement>(null);

  const unread = items.filter((i) => i.unread).length;
  const rows = tab === "Unread" ? items.filter((i) => i.unread) : items;

  useEffect(() => {
    if (!open) return;
    const node = wrapRef.current;
    const doc = node?.ownerDocument ?? document;
    const onDown = (e: MouseEvent) => {
      if (node && !node.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      bellRef.current?.focus({ preventScroll: true });
    };
    doc.addEventListener("mousedown", onDown);
    doc.addEventListener("keydown", onKey);
    return () => {
      doc.removeEventListener("mousedown", onDown);
      doc.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative flex h-full min-h-[560px] w-full flex-col overflow-hidden bg-white dark:bg-neutral-950">
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-neutral-200 px-4 dark:border-neutral-800">
        <div className="flex min-w-0 items-center gap-4">
          <span className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-[var(--rb-r-sm,6px)] bg-[var(--rb-accent,oklch(20.5%_0_0))] text-[11px] font-medium text-[var(--rb-accent-fg,oklch(100%_0_0))] dark:bg-[var(--rb-accent,oklch(100%_0_0))] dark:text-[var(--rb-accent-fg,oklch(20.5%_0_0))]">
              H
            </span>
            <span className="truncate text-[13px] font-medium text-neutral-900 dark:text-white">
              Halcyon
            </span>
          </span>
          <nav className="hidden items-center gap-1 sm:flex">
            {NAV.map((n, i) => (
              <a
                key={n}
                href="#"
                onClick={(e) => e.preventDefault()}
                aria-current={i === 0 ? "page" : undefined}
                className={cx(
                  "inline-flex h-8 items-center rounded-[var(--rb-r-md,8px)] px-2.5 text-[13px]",
                  i === 0
                    ? "bg-neutral-100 text-neutral-900 dark:bg-neutral-900 dark:text-white"
                    : "text-neutral-500 hover:bg-neutral-50 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-white",
                  transition,
                  focus,
                )}
              >
                {n}
              </a>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-1" ref={wrapRef}>
          <div className="relative">
            <button
              ref={bellRef}
              type="button"
              aria-haspopup="dialog"
              aria-expanded={open}
              aria-label={`Notifications, ${unread} unread`}
              onClick={() => setOpen((v) => !v)}
              className={cx(
                "relative inline-flex h-8 w-8 items-center justify-center rounded-[var(--rb-r-md,8px)] border text-neutral-600 dark:text-neutral-300",
                open
                  ? "border-neutral-200 bg-neutral-100 text-neutral-900 dark:border-neutral-800 dark:bg-neutral-900 dark:text-white"
                  : "border-transparent hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-900 dark:hover:text-white",
                transition,
                focus,
              )}
            >
              <Bell className="h-4 w-4" strokeWidth={1.75} />
              <AnimatePresence initial={false}>
                {unread > 0 && (
                  <motion.span
                    key="badge"
                    initial={reduce ? false : { opacity: 0, scale: 0.6 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={reduce ? undefined : { opacity: 0, scale: 0.6 }}
                    transition={{
                      type: "spring",
                      stiffness: 500,
                      damping: 28,
                    }}
                    className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--rb-accent,oklch(20.5%_0_0))] px-1 text-[10px] leading-none font-medium text-[var(--rb-accent-fg,oklch(100%_0_0))] tabular-nums ring-2 ring-white dark:bg-[var(--rb-accent,oklch(100%_0_0))] dark:text-[var(--rb-accent-fg,oklch(20.5%_0_0))] dark:ring-neutral-950"
                  >
                    {unread}
                  </motion.span>
                )}
              </AnimatePresence>
            </button>

            <AnimatePresence>
              {open && (
                <motion.div
                  role="dialog"
                  aria-label="Notifications"
                  initial={reduce ? false : { opacity: 0, y: -6, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={reduce ? undefined : { opacity: 0, y: -6, scale: 0.97 }}
                  transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                  className="absolute top-[calc(100%+8px)] right-0 z-40 w-[min(88vw,352px)] origin-top-right overflow-hidden rounded-[var(--rb-r-2xl,14px)] border border-neutral-200 bg-white shadow-[0_16px_40px_-20px_rgba(0,0,0,0.35)] dark:border-neutral-800 dark:bg-neutral-900"
                >
                  <div className="flex items-center justify-between gap-2 px-3 pt-3">
                    <div
                      role="tablist"
                      aria-label="Filter"
                      className="inline-flex rounded-[var(--rb-r-lg,10px)] border border-neutral-200/70 bg-neutral-50 p-1 dark:border-neutral-800 dark:bg-neutral-950"
                    >
                      {TABS.map((t) => {
                        const on = t === tab;
                        return (
                          <button
                            key={t}
                            role="tab"
                            type="button"
                            aria-selected={on}
                            onClick={() => setTab(t)}
                            className={cx(
                              "relative inline-flex h-6 items-center rounded-[var(--rb-r-sm,6px)] px-2 text-[12px]",
                              on
                                ? "text-neutral-900 dark:text-white"
                                : "text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white",
                              transition,
                              focus,
                            )}
                          >
                            {on && (
                              <motion.span
                                layoutId={`${uid}-pop-tab`}
                                transition={
                                  reduce
                                    ? { duration: 0 }
                                    : {
                                        type: "spring",
                                        stiffness: 420,
                                        damping: 34,
                                      }
                                }
                                className="absolute inset-0 rounded-[var(--rb-r-sm,6px)] border border-neutral-200/70 bg-white dark:border-neutral-800 dark:bg-neutral-900"
                              />
                            )}
                            <span className="relative">{t}</span>
                          </button>
                        );
                      })}
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        setItems((prev) =>
                          prev.map((i) => ({ ...i, unread: false })),
                        )
                      }
                      disabled={unread === 0}
                      className={cx(
                        "inline-flex h-7 items-center gap-1.5 rounded-[var(--rb-r-md,8px)] px-2 text-[12px] text-neutral-500 disabled:pointer-events-none disabled:opacity-40 dark:text-neutral-400",
                        "hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-white",
                        transition,
                        focus,
                      )}
                    >
                      <CheckCheck className="h-3.5 w-3.5" strokeWidth={1.75} />
                      Mark all read
                    </button>
                  </div>

                  <ul className="max-h-[264px] overflow-y-auto p-2">
                    {rows.length === 0 ? (
                      <li className="px-3 py-8 text-center text-[13px] text-neutral-500 dark:text-neutral-400">
                        No unread notifications
                      </li>
                    ) : (
                      rows.map((item) => {
                        const Icon = item.icon;
                        return (
                          <li key={item.id}>
                            <button
                              type="button"
                              onClick={() =>
                                setItems((prev) =>
                                  prev.map((i) =>
                                    i.id === item.id
                                      ? { ...i, unread: false }
                                      : i,
                                  ),
                                )
                              }
                              className={cx(
                                "flex w-full gap-2.5 rounded-[var(--rb-r-lg,10px)] p-2.5 text-left",
                                "hover:bg-neutral-100 dark:hover:bg-neutral-800",
                                transition,
                                focus,
                              )}
                            >
                              <span
                                className={cx(
                                  "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--rb-r-sm,6px)] border",
                                  item.unread
                                    ? "border-neutral-900 bg-[var(--rb-accent,oklch(20.5%_0_0))] text-[var(--rb-accent-fg,oklch(100%_0_0))] dark:border-white dark:bg-[var(--rb-accent,oklch(100%_0_0))] dark:text-[var(--rb-accent-fg,oklch(20.5%_0_0))]"
                                    : "border-neutral-200/70 bg-neutral-50 text-neutral-500 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-400",
                                  transition,
                                )}
                              >
                                <Icon className="h-3 w-3" strokeWidth={1.75} />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block text-[13px] leading-5 text-neutral-500 dark:text-neutral-400">
                                  <span className="text-neutral-900 dark:text-white">
                                    {item.actor}
                                  </span>{" "}
                                  {item.action}
                                </span>
                              </span>
                              <span className="shrink-0 text-[12px] text-neutral-400 tabular-nums dark:text-neutral-500">
                                {item.time}
                              </span>
                            </button>
                          </li>
                        );
                      })
                    )}
                  </ul>

                  <div className="p-2 pt-0">
                    <button
                      type="button"
                      onClick={() => setOpen(false)}
                      className={cx(
                        "inline-flex h-9 w-full items-center justify-center rounded-[var(--rb-r-lg,10px)] border border-neutral-200 bg-white text-[13px] text-neutral-700 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-300",
                        "hover:bg-neutral-50 dark:hover:bg-neutral-900",
                        transition,
                        focus,
                      )}
                    >
                      Open notification center
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <button
            type="button"
            aria-label="Settings"
            className={cx(
              "inline-flex h-8 w-8 items-center justify-center rounded-[var(--rb-r-md,8px)] border border-transparent text-neutral-600 dark:text-neutral-300",
              "hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-900 dark:hover:text-white",
              transition,
              focus,
            )}
          >
            <Settings className="h-4 w-4" strokeWidth={1.75} />
          </button>

          <span className="ml-1 flex h-7 w-7 items-center justify-center rounded-full border border-neutral-200 bg-neutral-50 text-[11px] font-medium text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300">
            AR
          </span>
        </div>
      </header>

      <div className="flex flex-1 items-center justify-center p-6">
        <p className="max-w-[38ch] text-center text-[13px] leading-6 text-neutral-400 dark:text-neutral-500">
          Open the bell to review recent activity. The panel closes on Escape or
          on a click outside, and returns focus to the trigger.
        </p>
      </div>
    </div>
  );
}
