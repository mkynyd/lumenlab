"use client";
import { StudyFeedback } from "./controls";
/* eslint-disable @next/next/no-img-element -- Owner-checked selected scan assets. */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  BookOpen,
  CalendarDays,
  Plus,
  ChevronLeft,
  ArrowUpRight,
} from "lucide-react";
import Onboarding2 from "@/components/blocks/onboarding-2";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CollectionLibrary } from "./collection-library";
import { ScheduleWorkspace } from "./schedule-workspace";
import { StudyContext, StudyMore } from "./actions";
import { UploadButton } from "./controls";
import type { Collection, Task, CalendarEvent } from "./types";
import { MarkdownContent } from "@/components/markdown/markdown-content";
import { BankBrowser } from "./bank-browser";
import { StudyAssistant } from "./assistant";
import { TextSelector } from "./text-selector";
import { StudyScanner } from "./scanner";
import type {
  CollectionInput,
  SelectedQuestion,
  Solution,
} from "@/lib/study/contracts";
type Item = {
  id: string;
  sourceOrdinal?: string | null;
  prompt: string;
  status: string;
  topics: string[];
  error: string | null;
  assets?: string[];
  solution?: Solution | null;
};
type Job = {
  id: string;
  status: string;
  stage: string;
  progress: number;
  error: string | null;
  attempts: number;
};
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    cache: "no-store",
    ...init,
    headers: {
      ...(init?.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...init?.headers,
    },
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(
      typeof body.error === "string" ? body.error : "操作失败，请重试",
    );
  return body;
}
export function StudyWorkspace() {
  const [tab, setTab] = useState<"collections" | "calendar">("collections");
  const [collections, setCollections] = useState<Collection[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [creating, setCreating] = useState(false);
  const [bankOpen, setBankOpen] = useState(false);
  const [notebook, setNotebook] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [items, setItems] = useState<Item[]>([]);
  const [detail, setDetail] = useState<Item | null>(null);
  const [editingPrompt, setEditingPrompt] = useState<string | null>(null);
  const [reveal, setReveal] = useState(false);
  const [textSource, setTextSource] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    id: string;
    pageCount: number;
    expiresAt: string;
  } | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  // Invalidated on mutations so an older GET cannot erase a freshly created card.
  const collectionRevision = useRef({ value: 0 });
  const reload = useCallback(async () => {
    const revision = ++collectionRevision.current.value;
    const results = await Promise.allSettled([
      api<{ collections: Collection[] }>("/api/study/collections").then(
        (data) => {
          if (revision === collectionRevision.current.value)
            setCollections(data.collections);
        },
      ),
      api<{ tasks: Task[] }>("/api/study/tasks").then((data) =>
        setTasks(data.tasks),
      ),
      api<{ events: CalendarEvent[] }>("/api/study/events").then((data) =>
        setEvents(data.events),
      ),
    ]);
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected")
      setError(
        failure.reason instanceof Error
          ? failure.reason.message
          : "部分学习数据加载失败，请重试",
      );
  }, []);
  useEffect(() => {
    const revision = collectionRevision.current;
    void reload().finally(() => setLoading(false));
    let active = true;
    void api<{ jobs: Job[] }>("/api/study/jobs")
      .then((data) => {
        if (active) setJob((previous) => previous ?? data.jobs[0] ?? null);
      })
      .catch((cause) => {
        if (active) setError(cause.message);
      });
    return () => {
      active = false;
      revision.value++;
    };
  }, [reload]);
  const reloadItems = useCallback(async () => {
    if (notebook)
      setItems(
        (
          await api<{ items: Item[] }>(
            `/api/study/notebooks/${notebook.id}/items`,
          )
        ).items,
      );
  }, [notebook]);
  useEffect(() => {
    if (!notebook) return;
    let active = true;
    void api<{ items: Item[] }>(`/api/study/notebooks/${notebook.id}/items`)
      .then((result) => {
        if (active) setItems(result.items);
      })
      .catch((cause) => {
        if (active) setError(cause.message);
      });
    return () => {
      active = false;
    };
  }, [notebook]);
  useEffect(() => {
    if (!job || ["completed", "failed"].includes(job.status)) return;
    let active = true;
    const timer = setInterval(() => {
      void api<{ job: Job }>(`/api/study/jobs/${job.id}`)
        .then(async (result) => {
          if (!active) return;
          setJob(result.job);
          if (result.job.status === "completed") {
            await reloadItems();
            await reload();
          }
        })
        .catch((cause) => {
          if (active) setError(cause.message);
        });
    }, 2500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [job, reloadItems, reload]);
  async function action(operation: () => Promise<void>) {
    setError("");
    setBusy(true);
    try {
      await operation();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }
  async function create(input: CollectionInput) {
    const result = await api<{ collection: Collection }>(
      "/api/study/collections",
      { method: "POST", body: JSON.stringify(input) },
    );
    collectionRevision.current.value++;
    setCollections((previous) => [
      result.collection,
      ...previous.filter((c) => c.id !== result.collection.id),
    ]);
    setCreating(false);
    setNotebook(null);
    setDetail(null);
    setTab("collections");
    setNotice(`已创建「${result.collection.name}」，可以打开错题本开始收录。`);
  }
  async function addNotebook(id: string, name: string) {
    const { notebook: created } = await api<{
      notebook: Collection["notebooks"][number];
    }>(`/api/study/collections/${id}/notebooks`, {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    collectionRevision.current.value++;
    setCollections((previous) =>
      previous.map((collection) =>
        collection.id === id
          ? { ...collection, notebooks: [...collection.notebooks, created] }
          : collection,
      ),
    );
    setNotice(`已添加错题本「${created.name}」。`);
  }
  async function openItem(item: Item, showAnswer = false, edit = false) {
    const { item: loaded } = await api<{ item: Item }>(
      `/api/study/items/${item.id}`,
    );
    setDetail(loaded);
    setReveal(showAnswer);
    setEditingPrompt(edit ? loaded.prompt : null);
  }

  async function submit(
    questions: SelectedQuestion[],
    scanMode: "color" | "grayscale",
  ) {
    if (!preview || !notebook) return;
    const result = await api<{ jobId: string }>(
      `/api/study/imports/${preview.id}/selection`,
      {
        method: "POST",
        body: JSON.stringify({ notebookId: notebook.id, questions, scanMode }),
      },
    );
    setPreview(null);
    setJob({
      id: result.jobId,
      status: "queued",
      progress: 0,
      stage: "等待处理",
      error: null,
      attempts: 0,
    });
    await reloadItems();
  }
  if (creating)
    return (
      <main className="mx-auto w-full max-w-4xl p-4 md:p-8">
        <Onboarding2 onCreate={create} onCancel={() => setCreating(false)} />
      </main>
    );
  if (textSource !== null && notebook)
    return (
      <main className="mx-auto w-full max-w-6xl p-4">
        <TextSelector
          source={textSource}
          onCancel={() => setTextSource(null)}
          onSubmit={async (questions) => {
            const result = await api<{ jobId: string }>(
              "/api/study/text-selection",
              {
                method: "POST",
                body: JSON.stringify({
                  notebookId: notebook.id,
                  source: textSource,
                  questions,
                }),
              },
            );
            setTextSource(null);
            setJob({
              id: result.jobId,
              status: "queued",
              stage: "等待处理",
              progress: 0,
              error: null,
              attempts: 0,
            });
            await reloadItems();
          }}
        />
      </main>
    );
  if (preview)
    return (
      <main className="mx-auto w-full max-w-7xl p-4 md:p-6">
        <StudyScanner
          preview={preview}
          onSubmit={submit}
          onCancel={async () => {
            await api(`/api/study/imports/${preview.id}`, { method: "DELETE" });
            setPreview(null);
          }}
        />
      </main>
    );
  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 p-4 md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav
          className="flex gap-1 rounded-xl bg-[var(--color-surface-hover)] p-1"
          aria-label="学习功能"
        >
          {(
            [
              ["collections", "题集与错题本", BookOpen],
              ["calendar", "学习日程", CalendarDays],
            ] as const
          ).map(([value, label, Icon]) => (
            <Button
              key={value}
              variant="secondary"
              aria-pressed={tab === value}
              className={
                tab === value
                  ? "h-10 bg-[var(--color-accent-muted)] px-4 text-[var(--color-accent)]"
                  : "h-10 bg-transparent px-4 text-[var(--color-text-secondary)]"
              }
              onClick={() => {
                setTab(value);
                setDetail(null);
              }}
            >
              <Icon />
              {label}
            </Button>
          ))}
        </nav>
        <Button className="ml-auto h-10 px-4" onClick={() => setCreating(true)}>
          <Plus />
          新建题集
        </Button>
        <StudyAssistant
          key={notebook?.id ?? tab}
          notebookId={tab === "collections" ? notebook?.id : undefined}
        />
      </div>
      {notice && (
        <div className="flex items-center gap-2">
          <StudyFeedback message={notice} />
          <Button variant="secondary" size="sm" onClick={() => setNotice("")}>
            清除提示
          </Button>
        </div>
      )}
      {error && <StudyFeedback message={error} error />}

      {loading && (
        <Button variant="secondary" disabled>
          加载中
        </Button>
      )}
      {job && (
        <section
          className="space-y-2 rounded-xl bg-[var(--color-surface-hover)] p-4"
          aria-label="错题处理进度"
        >
          <div className="flex justify-between gap-3">
            <span role="status" className="text-sm">
              {job.stage}
            </span>
            <span className="text-sm">{job.progress}%</span>
          </div>
          <Progress value={job.progress} label="错题处理进度" />
          {job.error && <StudyFeedback message={job.error} error />}
          {job.status === "failed" && job.attempts < 3 && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  await api(`/api/study/jobs/${job.id}`, { method: "POST" });
                  setJob({ ...job, status: "queued", error: null });
                })
              }
            >
              重试处理
            </Button>
          )}
        </section>
      )}
      {tab === "collections" && (
        <>
          {!notebook && (
            <CollectionLibrary
              key={creating ? "creating" : (collections[0]?.id ?? "empty")}
              collections={collections}
              loading={loading}
              onCreate={() => setCreating(true)}
              onOpen={(book) => {
                setNotebook(book);
                setItems([]);
                setDetail(null);
                setBankOpen(false);
              }}
              onAddNotebook={addNotebook}
            />
          )}
          {notebook && (
            <section className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setNotebook(null);
                    setDetail(null);
                  }}
                >
                  <ChevronLeft />
                  全部题集
                </Button>
                <h2 className="font-semibold">{notebook.name}</h2>
                <Button
                  variant="secondary"
                  className="h-10 px-4"
                  onClick={() => setBankOpen(true)}
                >
                  从题库选题
                </Button>
                <UploadButton
                  className="ml-auto"
                  variant="default"
                  label="上传试卷并选错题"
                  busyLabel="正在生成预览…"
                  multiple
                  accept="image/*,.pdf,.doc,.docx,.ppt,.pptx,.odt,.odp,.md,.markdown,.txt"
                  disabled={busy}
                  onChange={(event) => {
                    const files = Array.from(event.target.files ?? []);
                    event.target.value = "";
                    if (!files.length) return;
                    void action(async () => {
                      if (
                        files.some((file) =>
                          /\.(md|markdown|txt)$/i.test(file.name),
                        )
                      ) {
                        if (files.length !== 1 || files[0].size > 1024 * 1024)
                          throw new Error(
                            "Markdown 请单独上传，文件需在1MB以内",
                          );
                        setTextSource(await files[0].text());
                        return;
                      }
                      const form = new FormData();
                      for (const file of files) form.append("file", file);
                      setPreview(
                        await api("/api/study/imports", {
                          method: "POST",
                          body: form,
                        }),
                      );
                    });
                  }}
                />
              </div>
              {bankOpen && (
                <BankBrowser
                  notebookId={notebook.id}
                  onClose={() => setBankOpen(false)}
                  onSelected={async (jobId) => {
                    setBankOpen(false);
                    if (jobId)
                      setJob({
                        id: jobId,
                        status: "queued",
                        stage: "等待处理",
                        progress: 0,
                        error: null,
                        attempts: 0,
                      });
                    await reloadItems();
                    await reload();
                  }}
                />
              )}
              {items.map((item, index) => {
                const actions = [
                  {
                    label: "查看题目",
                    disabled: busy,
                    onSelect: () => void action(() => openItem(item)),
                  },
                  {
                    label: "查看答案与解析",
                    disabled: busy || item.status !== "ready",
                    onSelect: () => void action(() => openItem(item, true)),
                  },
                  {
                    label: "校对题面",
                    disabled:
                      busy ||
                      !["ready", "needs_review", "failed"].includes(
                        item.status,
                      ),
                    onSelect: () =>
                      void action(() => openItem(item, false, true)),
                  },
                  {
                    label: "复制题目",
                    disabled: !item.prompt,
                    onSelect: () =>
                      void action(async () => {
                        await navigator.clipboard.writeText(item.prompt);
                        setNotice("题目已复制。");
                      }),
                  },
                ];
                return (
                  <StudyContext key={item.id} actions={actions}>
                    <article className="flex flex-col gap-3 rounded-xl bg-[var(--color-surface-hover)] p-5">
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-lg bg-[var(--color-surface)] p-3 text-left text-sm"
                          onClick={() => void action(() => openItem(item))}
                        >
                          <span className="font-medium">
                            错题 {items.length - index}
                            {item.sourceOrdinal
                              ? ` · 原题号 ${item.sourceOrdinal}`
                              : ""}
                          </span>
                          <span className="shrink-0 text-xs text-[var(--color-accent)]">
                            {item.status === "ready"
                              ? "解析完成"
                              : item.status === "needs_review"
                                ? "需要校对"
                                : "处理中"}
                            <ArrowUpRight className="ml-1 inline size-3.5" />
                          </span>
                        </button>
                        <StudyMore
                          label={`错题${items.length - index}`}
                          actions={actions}
                        />
                      </div>
                      <div className="pointer-events-none max-h-28 overflow-hidden text-sm text-[var(--color-text-secondary)]">
                        <MarkdownContent
                          content={item.prompt || "正在识别题目…"}
                        />
                      </div>
                      {item.topics.length > 0 && (
                        <p className="text-xs text-[var(--color-accent)]">
                          {item.topics.join(" · ")}
                        </p>
                      )}
                    </article>
                  </StudyContext>
                );
              })}
            </section>
          )}
          <Dialog
            open={!!detail}
            onOpenChange={(open) => {
              if (!open) setDetail(null);
            }}
          >
            <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-3xl">
              <DialogHeader className="sr-only">
                <DialogTitle>题目详情</DialogTitle>
                <DialogDescription>
                  题干、选项与插图完整保留，解析按需展开。
                </DialogDescription>
              </DialogHeader>
              {detail && (
                <div className="flex flex-col gap-4">
                  <MarkdownContent content={detail.prompt || "题目识别中"} />
                  {detail.assets?.map((src, index) => (
                    <img
                      key={src}
                      className="max-h-[420px] max-w-full"
                      src={src}
                      alt={`题目原始选中区域${index + 1}`}
                    />
                  ))}
                  {["ready", "needs_review", "failed"].includes(
                    detail.status,
                  ) && (
                    <Button
                      variant="secondary"
                      onClick={() => setEditingPrompt(detail.prompt)}
                    >
                      校对题面并重新解析
                    </Button>
                  )}
                  {editingPrompt !== null && (
                    <div className="space-y-3">
                      <textarea
                        className="min-h-48 w-full rounded-md bg-[var(--color-surface-hover)] p-3 text-sm"
                        aria-label="校对完整题面"
                        maxLength={200000}
                        value={editingPrompt}
                        onChange={(event) =>
                          setEditingPrompt(event.target.value)
                        }
                      />

                      <Button
                        disabled={busy || !editingPrompt.trim()}
                        onClick={() =>
                          void action(async () => {
                            const result = await api<{ jobId: string }>(
                              `/api/study/items/${detail.id}`,
                              {
                                method: "PATCH",
                                body: JSON.stringify({
                                  prompt: editingPrompt,
                                  confirmedComplete: true,
                                }),
                              },
                            );
                            setDetail(null);
                            setEditingPrompt(null);
                            setJob({
                              id: result.jobId,
                              status: "queued",
                              stage: "等待处理",
                              progress: 0,
                              error: null,
                              attempts: 0,
                            });
                            await reloadItems();
                          })
                        }
                      >
                        确认完整并重新解析
                      </Button>
                    </div>
                  )}
                  {detail.error && (
                    <StudyFeedback message={detail.error} error />
                  )}
                  {detail.solution && (
                    <>
                      <Button
                        variant="secondary"
                        onClick={() => setReveal(!reveal)}
                      >
                        {reveal ? "收起解析" : "查看答案与解析"}
                      </Button>
                      {reveal && (
                        <MarkdownContent
                          content={`${detail.solution.answer}\n\n${detail.solution.explanation}`}
                        />
                      )}
                    </>
                  )}
                </div>
              )}
            </DialogContent>
          </Dialog>
        </>
      )}
      {tab === "calendar" && (
        <ScheduleWorkspace
          tasks={tasks}
          events={events}
          busy={busy}
          onApplied={reload}
          onCreateTask={async (data) => {
            await api("/api/study/tasks", {
              method: "POST",
              body: JSON.stringify(data),
            });
            await reload();
          }}
          onComplete={(task) =>
            void action(async () => {
              await api(`/api/study/tasks/${task.id}`, {
                method: "PATCH",
                body: JSON.stringify({ completed: !task.completed }),
              });
              await reload();
            })
          }
          onRemoveEvent={(event) =>
            void action(async () => {
              await api(`/api/study/events/${event.id}`, { method: "DELETE" });
              await reload();
            })
          }
        />
      )}
    </main>
  );
}
