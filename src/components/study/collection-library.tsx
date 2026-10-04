"use client";

import { useState } from "react";
import { ArrowUpRight, BookOpen, Library, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StudyContext, StudyMore } from "./actions";
import type { Collection } from "./types";

export function CollectionLibrary({
  collections,
  loading,
  onCreate,
  onOpen,
  onAddNotebook,
}: {
  collections: Collection[];
  loading: boolean;
  onCreate: () => void;
  onOpen: (book: Collection["notebooks"][number]) => void;
  onAddNotebook: (id: string, name: string) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<Collection | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const filtered = collections.filter((collection) =>
    `${collection.name} ${collection.subject} ${collection.exam} ${collection.notebooks.map((b) => b.name).join(" ")}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const add = (collection: Collection) => {
    setTarget(collection);
    setName("");
    setError("");
  };
  return (
    <section className="flex flex-col gap-5" aria-label="我的题集">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">
            {" "}
            <span className="ml-2 text-sm font-normal text-[var(--color-text-secondary)]">
              {collections.length} 本
            </span>
          </h2>
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-3 size-4 text-[var(--color-text-tertiary)]" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="搜索题集和错题本"
            placeholder="搜索题集、学科或错题本"
            className="h-10 pl-9"
          />
        </div>
      </div>

      <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((collection) => {
          const actions = [
            {
              label: "打开错题本",
              onSelect: () => onOpen(collection.notebooks[0]),
              disabled: !collection.notebooks.length,
            },
            { label: "新增错题本", onSelect: () => add(collection) },
          ];
          return (
            <StudyContext key={collection.id} actions={actions}>
              <article
                className="flex flex-col gap-5 rounded-2xl bg-[var(--color-surface-hover)] p-5"
                aria-label={`题集：${collection.name}`}
              >
                <div className="flex items-start gap-3">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-[var(--color-accent-muted)] text-[var(--color-accent)]">
                    <Library className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="break-words font-semibold">
                      {collection.name}
                    </h3>
                    <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                      {collection.subject}
                      {collection.exam ? ` · ${collection.exam}` : ""}
                    </p>
                  </div>
                  <StudyMore label={collection.name} actions={actions} />
                </div>
                <div className="flex items-center gap-3 text-xs text-[var(--color-text-secondary)]">
                  <span>{collection.notebooks.length} 本错题本</span>
                  <span>
                    {collection.notebooks.reduce(
                      (total, b) => total + (b._count?.items ?? 0),
                      0,
                    )}{" "}
                    道错题
                  </span>
                </div>
                <div className="flex flex-col gap-2">
                  {collection.notebooks.map((book) => (
                    <StudyContext
                      key={book.id}
                      actions={[
                        { label: "打开错题本", onSelect: () => onOpen(book) },
                      ]}
                    >
                      <Button
                        variant="secondary"
                        className="h-auto min-h-12 w-full justify-between gap-3 whitespace-normal bg-[var(--color-surface)] p-3 text-left"
                        onClick={() => onOpen(book)}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <BookOpen className="size-4 shrink-0 text-[var(--color-accent)]" />
                          <span className="break-words">{book.name}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2 text-xs text-[var(--color-text-secondary)]">
                          {book._count?.items ?? 0} 题
                          <ArrowUpRight className="size-3.5" />
                        </span>
                      </Button>
                    </StudyContext>
                  ))}
                </div>
                <Button
                  variant="secondary"
                  className="h-10 w-full bg-[var(--color-accent-muted)] text-[var(--color-accent)]"
                  onClick={() => add(collection)}
                >
                  <Plus />
                  新增错题本
                </Button>
              </article>
            </StudyContext>
          );
        })}
      </div>
      {!loading && !collections.length && (
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-[var(--color-surface-hover)] px-6 py-16 text-center">
          <span className="flex size-14 items-center justify-center rounded-xl bg-[var(--color-accent-muted)] text-[var(--color-accent)]">
            <BookOpen className="size-6" />
          </span>

          <Button className="mt-3 h-10 px-5" onClick={onCreate}>
            <Plus />
            创建第一本题集
          </Button>
        </div>
      )}

      <Dialog
        open={!!target}
        onOpenChange={(open) => {
          if (!open && !busy) setTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新增错题本</DialogTitle>
            <DialogDescription>
              收录到「{target?.name}」，按章节或专题分开整理。
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!target || !name.trim()) return;
              setBusy(true);
              setError("");
              try {
                await onAddNotebook(target.id, name.trim());
                setTarget(null);
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : "添加失败");
              } finally {
                setBusy(false);
              }
            }}
          >
            <label htmlFor="new-notebook-name" className="text-sm font-medium">错题本名称</label>
            <Input
              id="new-notebook-name"
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-label="新错题本名称"
              placeholder="错题本名称"
              required
              maxLength={100}
            />
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button disabled={busy} type="submit" className="h-10">
              {busy ? "正在添加…" : "添加错题本"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
