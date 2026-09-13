"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  ArrowUp,
  Check,
  ChevronUp,
  Gauge,
  Layers,
  Paperclip,
  Sparkles,
  Wallet,
  Zap,
} from "lucide-react";

const cx = (...c: (string | false | null | undefined)[]) =>
  c.filter(Boolean).join(" ");

const focus =
  "focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rb-accent,oklch(20.5%_0_0))] dark:focus-visible:outline-[var(--rb-accent,oklch(100%_0_0))]";

const transition =
  "transition-[background-color,border-color,color,transform] duration-150 ease-out";

type Effort = "brief" | "balanced" | "detailed";

type Model = {
  id: string;
  name: string;
  provider: string;
  note?: string;
  summary: string;
  context: string;
  speed: string;
  cost: string;
  /** Effort levels this model accepts. Empty means no reasoning control. */
  efforts: Effort[];
};

const MODELS: Model[] = [
  {
    id: "auto",
    name: "Auto",
    provider: "Northwind AI",
    note: "Recommended",
    summary: "Routes every turn to whichever model fits the request best.",
    context: "200K tokens",
    speed: "Varies by turn",
    cost: "Metered",
    efforts: ["brief", "balanced", "detailed"],
  },
  {
    id: "atlas",
    name: "Atlas",
    provider: "Meridian Labs",
    summary:
      "The strongest general model. Best for multi-step work that spans several files.",
    context: "200K tokens",
    speed: "Standard",
    cost: "4 credits per turn",
    efforts: ["brief", "balanced", "detailed"],
  },
  {
    id: "atlas-long",
    name: "Atlas Long",
    provider: "Meridian Labs",
    note: "1M context",
    summary:
      "Atlas with a one million token window for whole repositories and long transcripts.",
    context: "1M tokens",
    speed: "Slower to first token",
    cost: "9 credits per turn",
    efforts: ["balanced", "detailed"],
  },
  {
    id: "quill",
    name: "Quill",
    provider: "Meridian Labs",
    summary:
      "Tuned for drafting and rewriting prose. Keeps tone and structure steady.",
    context: "128K tokens",
    speed: "Fast",
    cost: "2 credits per turn",
    efforts: [],
  },
  {
    id: "ember",
    name: "Ember",
    provider: "Orbital",
    summary: "Quick and inexpensive. Good for small edits and short answers.",
    context: "64K tokens",
    speed: "Fastest",
    cost: "1 credit per turn",
    efforts: ["brief", "balanced"],
  },
  {
    id: "wren",
    name: "Wren",
    provider: "Orbital",
    note: "On device",
    summary: "Runs locally. Nothing in the conversation leaves this machine.",
    context: "32K tokens",
    speed: "Depends on hardware",
    cost: "Free",
    efforts: [],
  },
];

const EFFORTS: {
  id: Effort;
  label: string;
  segments: number;
  blurb: string;
}[] = [
  {
    id: "brief",
    label: "Brief",
    segments: 1,
    blurb: "Answers immediately with little planning.",
  },
  {
    id: "balanced",
    label: "Balanced",
    segments: 3,
    blurb: "Thinks through the request before answering.",
  },
  {
    id: "detailed",
    label: "Detailed",
    segments: 5,
    blurb: "Plans at length and checks its own work.",
  },
];

const THREAD = [
  {
    id: "m1",
    role: "user" as const,
    text: "Our depot capacity model is off by roughly 8% on Tuesdays. Where should I look first?",
  },
  {
    id: "m2",
    role: "assistant" as const,
    text: "Tuesday is the only day the model reads the carrier feed before the overnight reconciliation finishes, so a slice of Monday's late arrivals is counted twice. Start with the ingest window in loaders/carrier_feed.py, then compare the reconciled totals for the last four Tuesdays against the raw feed.",
  },
  {
    id: "m3",
    role: "user" as const,
    text: "Makes sense. Draft the fix and list what it changes.",
  },
  {
    id: "m4",
    role: "assistant" as const,
    text: "The patch moves the ingest cutoff to 04:00 so it always lands after reconciliation, drops the duplicate rows that the old window let through, and adds a regression test that replays four weeks of Tuesday feeds. Nothing outside the loader changes, and last week's totals fall back in line to within 0.3%.",
  },
  {
    id: "m5",
    role: "user" as const,
    text: "Does the test catch the reverse case, where reconciliation finishes late?",
  },
  {
    id: "m6",
    role: "assistant" as const,
    text: "It does. The fixture parametrises the reconciliation finish time, so a run that lands at 05:10 fails on row counts instead of passing quietly. I also kept the old window behind a flag for one release, which lets you diff both outputs on staging before the cutover.",
  },
];

export default function AiChat9() {
  const rootRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState("atlas");
  const [active, setActive] = useState(1);
  const [effort, setEffort] = useState<Record<string, Effort>>({
    auto: "balanced",
    atlas: "balanced",
    "atlas-long": "detailed",
    ember: "brief",
  });
  const [value, setValue] = useState("");

  const selectedModel = useMemo(
    () => MODELS.find((m) => m.id === selected) ?? MODELS[0],
    [selected],
  );
  const preview = MODELS[active];
  const previewEffort = effort[preview.id] ?? preview.efforts[0];
  const previewSegments =
    EFFORTS.find((e) => e.id === previewEffort)?.segments ?? 0;

  useEffect(() => {
    if (!open) return;
    const doc = rootRef.current?.ownerDocument ?? document;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus({ preventScroll: true });
    };
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    doc.addEventListener("keydown", onKey);
    doc.addEventListener("pointerdown", onPointerDown);
    return () => {
      doc.removeEventListener("keydown", onKey);
      doc.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  useEffect(() => {
    if (open) listRef.current?.focus({ preventScroll: true });
  }, [open]);

  const commit = (index: number) => {
    setSelected(MODELS[index].id);
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  };

  const onListKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActive((i) => (i + 1) % MODELS.length);
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive((i) => (i - 1 + MODELS.length) % MODELS.length);
        break;
      case "Home":
        e.preventDefault();
        setActive(0);
        break;
      case "End":
        e.preventDefault();
        setActive(MODELS.length - 1);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        commit(active);
        break;
    }
  };

  const setPreviewEffort = (next: Effort) =>
    setEffort((prev) => ({ ...prev, [preview.id]: next }));

  return (
    <div
      ref={rootRef}
      className="relative flex h-full min-h-[720px] w-full flex-col overflow-hidden bg-white dark:bg-neutral-950"
    >
      <header className="shrink-0">
        <div className="mx-auto flex h-12 w-full max-w-3xl items-center gap-3 px-4 sm:px-6">
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
            Depot capacity model
          </p>
          <span className="shrink-0 text-xs text-neutral-500 dark:text-neutral-400">
            {selectedModel.name}
            {selectedModel.efforts.length > 0 &&
              ` · ${EFFORTS.find((e) => e.id === (effort[selectedModel.id] ?? selectedModel.efforts[0]))?.label}`}
          </span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto mt-auto w-full max-w-3xl space-y-5 px-4 py-4 sm:px-6">
          {THREAD.map((message) =>
            message.role === "user" ? (
              <div key={message.id} className="flex justify-end">
                <p className="max-w-[85%] rounded-[var(--rb-r-2xl,14px)] bg-neutral-100 px-3.5 py-2.5 text-sm leading-6 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100">
                  {message.text}
                </p>
              </div>
            ) : (
              <div key={message.id} className="flex gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-neutral-200/70 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900">
                  <Sparkles
                    aria-hidden="true"
                    className="h-3 w-3 text-neutral-600 dark:text-neutral-400"
                  />
                </span>
                <p className="min-w-0 text-sm leading-6 text-neutral-700 dark:text-neutral-300">
                  {message.text}
                </p>
              </div>
            ),
          )}
        </div>
      </div>

      <div className="shrink-0">
        <div className="mx-auto w-full max-w-3xl px-4 pb-4 sm:px-6">
          <div className="rounded-[var(--rb-r-2xl,14px)] border border-neutral-200 bg-white transition-colors duration-150 focus-within:border-neutral-300 dark:border-neutral-800 dark:bg-neutral-900 dark:focus-within:border-neutral-700">
            <textarea
              rows={2}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Reply, or pick a different model below"
              aria-label="Message"
              className="block max-h-40 w-full resize-none bg-transparent px-3.5 pt-3 text-sm leading-6 text-neutral-900 outline-none placeholder:text-neutral-400 dark:text-neutral-100 dark:placeholder:text-neutral-500"
            />

            <div className="flex items-center gap-1.5 px-3 pt-1 pb-3">
              <div ref={wrapRef} className="relative">
                <button
                  ref={triggerRef}
                  type="button"
                  onClick={() => {
                    const index = MODELS.findIndex((m) => m.id === selected);
                    setActive(index === -1 ? 0 : index);
                    setOpen((v) => !v);
                  }}
                  aria-haspopup="listbox"
                  aria-expanded={open}
                  className={cx(
                    "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-[var(--rb-r-md,8px)] bg-neutral-100 pr-2 pl-2.5 text-[13px] font-medium text-neutral-900 hover:bg-neutral-200 active:scale-[0.97] dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700",
                    transition,
                    focus,
                  )}
                >
                  <Sparkles
                    aria-hidden="true"
                    className="h-3.5 w-3.5 shrink-0 text-neutral-500 dark:text-neutral-400"
                  />
                  {selectedModel.name}
                  <ChevronUp
                    aria-hidden="true"
                    className={cx(
                      "h-3.5 w-3.5 shrink-0 text-neutral-500 transition-transform duration-150 ease-out motion-reduce:transition-none dark:text-neutral-400",
                      !open && "rotate-180",
                    )}
                  />
                </button>

                {open && (
                  <div className="absolute bottom-full left-0 z-50 mb-2 flex origin-bottom-left animate-[pickerIn_140ms_cubic-bezier(0.23,1,0.32,1)] items-end gap-2 motion-reduce:animate-none">
                    <div
                      ref={listRef}
                      role="listbox"
                      aria-label="Model"
                      aria-activedescendant={`model-${preview.id}`}
                      tabIndex={-1}
                      onKeyDown={onListKeyDown}
                      className="max-h-[366px] w-[224px] shrink-0 overflow-y-auto rounded-[var(--rb-r-2xl,14px)] border border-neutral-200 bg-white p-1 shadow-[0_8px_28px_-8px_rgba(0,0,0,0.16)] outline-none dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-[0_8px_28px_-8px_rgba(0,0,0,0.6)]"
                    >
                      <p className="px-2 pt-1.5 pb-1 text-[11px] font-medium tracking-wider text-neutral-500 uppercase dark:text-neutral-400">
                        Model
                      </p>
                      {MODELS.map((model, index) => (
                        <button
                          key={model.id}
                          id={`model-${model.id}`}
                          type="button"
                          role="option"
                          aria-selected={model.id === selected}
                          tabIndex={-1}
                          onMouseEnter={() => setActive(index)}
                          onFocus={() => setActive(index)}
                          onClick={() => commit(index)}
                          className={cx(
                            "flex w-full cursor-pointer items-center gap-2 rounded-[var(--rb-r-lg,10px)] px-2 py-1.5 text-left",
                            transition,
                            index === active
                              ? "bg-neutral-100 dark:bg-neutral-800"
                              : "bg-transparent",
                          )}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5">
                              <span className="truncate text-[13px] font-medium text-neutral-900 dark:text-neutral-100">
                                {model.name}
                              </span>
                              {model.note && (
                                <span className="shrink-0 rounded-[var(--rb-r-xs,4px)] bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                                  {model.note}
                                </span>
                              )}
                            </span>
                            <span className="mt-0.5 block truncate text-xs text-neutral-500 dark:text-neutral-400">
                              {model.provider}
                            </span>
                          </span>
                          {model.id === selected && (
                            <Check
                              aria-hidden="true"
                              strokeWidth={2.5}
                              className="h-3.5 w-3.5 shrink-0 text-neutral-900 dark:text-white"
                            />
                          )}
                        </button>
                      ))}
                    </div>

                    <div className="hidden h-[366px] w-[290px] shrink-0 flex-col rounded-[var(--rb-r-2xl,14px)] border border-neutral-200 bg-white p-4 shadow-[0_8px_28px_-8px_rgba(0,0,0,0.16)] sm:flex dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-[0_8px_28px_-8px_rgba(0,0,0,0.6)]">
                      <p className="text-sm font-medium tracking-[-0.01em] text-neutral-900 dark:text-neutral-50">
                        {preview.name}
                      </p>
                      <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                        {preview.provider}
                      </p>
                      <p className="mt-2 text-[13px] leading-5 text-neutral-700 dark:text-neutral-300">
                        {preview.summary}
                      </p>

                      <dl className="mt-3 mb-auto space-y-1">
                        {[
                          {
                            icon: Layers,
                            label: "Context",
                            value: preview.context,
                          },
                          { icon: Gauge, label: "Speed", value: preview.speed },
                          { icon: Wallet, label: "Cost", value: preview.cost },
                        ].map((row) => {
                          const Icon = row.icon;
                          return (
                            <div
                              key={row.label}
                              className="flex items-center gap-2"
                            >
                              <Icon
                                aria-hidden="true"
                                className="h-3.5 w-3.5 shrink-0 text-neutral-400 dark:text-neutral-500"
                              />
                              <dt className="text-xs text-neutral-500 dark:text-neutral-400">
                                {row.label}
                              </dt>
                              <dd className="ml-auto truncate text-xs font-medium text-neutral-900 dark:text-neutral-100">
                                {row.value}
                              </dd>
                            </div>
                          );
                        })}
                      </dl>

                      <div className="mt-4 shrink-0 rounded-[var(--rb-r-lg,10px)] bg-neutral-50 p-3 dark:bg-neutral-950">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[11px] font-medium tracking-wider text-neutral-500 uppercase dark:text-neutral-400">
                            Reasoning
                          </p>
                          <span className="flex items-center gap-1 text-xs font-medium text-neutral-900 dark:text-neutral-100">
                            <Zap aria-hidden="true" className="h-3 w-3" />
                            {preview.efforts.length === 0
                              ? "Not supported"
                              : EFFORTS.find((e) => e.id === previewEffort)
                                  ?.label}
                          </span>
                        </div>

                        <div className="mt-2 flex gap-1">
                          {[0, 1, 2, 3, 4].map((i) => (
                            <span
                              key={i}
                              className={cx(
                                "h-1.5 flex-1 rounded-full transition-colors duration-200 ease-out motion-reduce:transition-none",
                                i < previewSegments
                                  ? "bg-[var(--rb-accent,oklch(20.5%_0_0))] dark:bg-[var(--rb-accent,oklch(100%_0_0))]"
                                  : "bg-neutral-200 dark:bg-neutral-800",
                              )}
                            />
                          ))}
                        </div>

                        {preview.efforts.length === 0 ? (
                          <p className="mt-2.5 text-xs leading-5 text-neutral-500 dark:text-neutral-400">
                            This model answers directly and has no thinking
                            budget to set.
                          </p>
                        ) : (
                          <>
                            <div
                              role="radiogroup"
                              aria-label="Reasoning effort"
                              className="mt-2.5 flex gap-1 rounded-[var(--rb-r-md,8px)] bg-neutral-200/60 p-1 dark:bg-neutral-800"
                            >
                              {EFFORTS.map((option) => {
                                const supported = preview.efforts.includes(
                                  option.id,
                                );
                                const on = previewEffort === option.id;
                                return (
                                  <button
                                    key={option.id}
                                    type="button"
                                    role="radio"
                                    aria-checked={on}
                                    disabled={!supported}
                                    onClick={() => setPreviewEffort(option.id)}
                                    className={cx(
                                      "h-6 flex-1 cursor-pointer rounded-[var(--rb-r-xs,4px)] text-xs font-medium disabled:pointer-events-none disabled:opacity-40",
                                      transition,
                                      focus,
                                      on
                                        ? "bg-white text-neutral-900 shadow-[0_1px_2px_rgba(0,0,0,0.08)] dark:bg-neutral-950 dark:text-neutral-50"
                                        : "text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100",
                                    )}
                                  >
                                    {option.label}
                                  </button>
                                );
                              })}
                            </div>
                            <p className="mt-2 text-xs leading-5 text-neutral-500 dark:text-neutral-400">
                              {
                                EFFORTS.find((e) => e.id === previewEffort)
                                  ?.blurb
                              }
                            </p>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <button
                type="button"
                aria-label="Attach a file"
                className={cx(
                  "inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-[var(--rb-r-md,8px)] text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 active:scale-[0.97] dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100",
                  transition,
                  focus,
                )}
              >
                <Paperclip aria-hidden="true" className="h-4 w-4" />
              </button>

              <button
                type="button"
                aria-label="Send"
                disabled={value.trim().length === 0}
                className={cx(
                  "ml-auto inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-[var(--rb-r-md,8px)] bg-[var(--rb-accent,oklch(20.5%_0_0))] text-[var(--rb-accent-fg,oklch(100%_0_0))] hover:bg-[color-mix(in_oklab,var(--rb-accent,oklch(20.5%_0_0))_90%,transparent)] active:scale-95 disabled:bg-neutral-200 disabled:text-neutral-400 dark:bg-[var(--rb-accent,oklch(100%_0_0))] dark:text-[var(--rb-accent-fg,oklch(20.5%_0_0))] dark:hover:bg-[color-mix(in_oklab,var(--rb-accent,oklch(100%_0_0))_90%,transparent)] dark:disabled:bg-neutral-800 dark:disabled:text-neutral-600",
                  transition,
                  focus,
                )}
              >
                <ArrowUp aria-hidden="true" className="h-4 w-4" />
              </button>
            </div>
          </div>

          <p className="mt-2 text-center text-xs text-neutral-500 dark:text-neutral-400">
            {selectedModel.name} runs on {selectedModel.provider}. Answers can
            be wrong, so check anything that matters.
          </p>
        </div>
      </div>

      <style>{`@keyframes pickerIn{from{opacity:0;transform:translateY(6px) scale(0.98)}to{opacity:1;transform:none}}`}</style>
    </div>
  );
}
