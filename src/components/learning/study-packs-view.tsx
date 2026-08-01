"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type {
  StudyPackDto,
  StudyPackOutlineItemDto,
  StudyPackSectionDto,
} from "@/lib/hooks/use-learning-api";
import {
  useCreateStudyPack,
  useGenerateStudyPack,
  usePublishStudyPack,
  useRegenerateStudyPackSection,
  useSaveStudyPackSection,
  useStudyPack,
  useStudyPacks,
  useUpdateStudyPackOutline,
} from "@/lib/hooks/use-learning-study-packs";
import { EmptyState } from "@/components/learning/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const SECTION_STATUS_LABELS: Record<string, string> = {
  draft: "未生成",
  queued: "排队中",
  generating: "生成中",
  ready: "已完成",
  failed: "失败",
  stale: "已过期",
};

function SectionStatusBadge({ status }: { status: string }) {
  const tone =
    status === "ready"
      ? "bg-[var(--color-accent-muted)] text-[var(--color-accent)]"
      : status === "failed"
        ? "bg-[var(--color-error-muted)] text-[var(--color-error)]"
        : status === "generating" || status === "queued"
          ? "bg-[var(--color-warning-muted)] text-[var(--color-warning)]"
          : "bg-[var(--color-control)] text-[var(--color-text-secondary)]";
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-xs font-medium",
        tone
      )}
    >
      {SECTION_STATUS_LABELS[status] ?? status}
    </span>
  );
}

function OutlineBadge({ status }: { status: "draft" | "confirmed" }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-xs font-medium",
        status === "confirmed"
          ? "bg-[var(--color-accent-muted)] text-[var(--color-accent)]"
          : "bg-[var(--color-control)] text-[var(--color-text-secondary)]"
      )}
    >
      {status === "confirmed" ? "大纲已确认" : "大纲待确认"}
    </span>
  );
}

interface OutlineEditorProps {
  projectId: string;
  pack: StudyPackDto;
}

function OutlineEditor({ projectId, pack }: OutlineEditorProps) {
  const saveOutline = useUpdateStudyPackOutline(projectId, pack.id);
  const [items, setItems] = useState<StudyPackOutlineItemDto[]>(
    () =>
      pack.outline.map((item) => ({
        key: item.key,
        title: item.title,
        description: item.description,
      }))
  );
  const [dirty, setDirty] = useState(false);

  const updateItem = (index: number, patch: Partial<StudyPackOutlineItemDto>) => {
    setItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item
      )
    );
    setDirty(true);
  };

  const removeItem = (index: number) => {
    setItems((current) => current.filter((_, itemIndex) => itemIndex !== index));
    setDirty(true);
  };

  const addItem = () => {
    const nextIndex = items.length + 1;
    setItems((current) => [
      ...current,
      {
        key: `section-${nextIndex}`,
        title: `章节 ${nextIndex}`,
        description: null,
      },
    ]);
    setDirty(true);
  };

  const save = (status?: "draft" | "confirmed") => {
    saveOutline.mutate({
      outline: items.map((item, index) => ({
        key: item.key.trim() || `section-${index + 1}`,
        title: item.title.trim() || `章节 ${index + 1}`,
        description: item.description,
      })),
      ...(status === undefined ? {} : { status }),
    });
    setDirty(false);
  };

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-[var(--color-text-secondary)]">
          大纲章节
        </span>
        <button
          type="button"
          onClick={addItem}
          className="text-xs font-medium text-[var(--color-accent)]"
        >
          添加章节
        </button>
      </div>
      <ul className="flex flex-col gap-1.5">
        {items.map((item, index) => (
          <li key={`${item.key}-${index}`} className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <Input
                aria-label={`章节 ${index + 1} 标题`}
                value={item.title}
                onChange={(event) => updateItem(index, { title: event.target.value })}
                disabled={saveOutline.isPending}
              />
              <button
                type="button"
                onClick={() => removeItem(index)}
                disabled={saveOutline.isPending}
                className="text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-error)]"
              >
                移除
              </button>
            </div>
            <Input
              aria-label={`章节 ${index + 1} 说明`}
              value={item.description ?? ""}
              onChange={(event) =>
                updateItem(index, { description: event.target.value })
              }
              placeholder="章节说明（可选）"
              disabled={saveOutline.isPending}
            />
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => save()}
          disabled={!dirty || saveOutline.isPending}
        >
          {saveOutline.isPending ? "保存中…" : "保存大纲"}
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => save("confirmed")}
          disabled={items.length === 0 || saveOutline.isPending}
        >
          确认大纲
        </Button>
        <div aria-live="polite">
          {saveOutline.isError && (
            <p role="alert" className="text-xs text-[var(--color-error)]">
              保存大纲失败，请重试。
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

interface SectionCardProps {
  projectId: string;
  pack: StudyPackDto;
  section: StudyPackSectionDto;
}

function SectionCard({ projectId, pack, section }: SectionCardProps) {
  const saveSection = useSaveStudyPackSection(projectId, pack.id);
  const regenerate = useRegenerateStudyPackSection(projectId, pack.id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(section.content ?? "");
  const [expanded, setExpanded] = useState(false);

  const canRegenerate = pack.outlineStatus === "confirmed";

  const save = () => {
    saveSection.mutate({ sectionId: section.id, content: draft });
    setEditing(false);
  };

  return (
    <li className="flex min-w-0 flex-col gap-1.5 py-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-sm font-medium text-[var(--color-text-primary)]">
          {section.title}
        </span>
        <SectionStatusBadge status={section.status} />
        {section.userEdited && (
          <span className="rounded-full bg-[var(--color-accent-muted)] px-2 py-0.5 text-xs text-[var(--color-accent)]">
            已手动编辑
          </span>
        )}
      </div>
      {section.failureReason && (
        <p role="alert" className="text-xs text-[var(--color-error)]">
          失败原因：{section.failureReason}
        </p>
      )}
      {section.content && !editing && (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="self-start text-xs font-medium text-[var(--color-accent)]"
        >
          {expanded ? "收起内容" : "查看内容"}
        </button>
      )}
      {expanded && !editing && (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius-md)] bg-[var(--color-control)] p-3 text-xs text-[var(--color-text-secondary)]">
          {section.content}
        </pre>
      )}
      {editing ? (
        <div className="flex flex-col gap-1.5">
          <Textarea
            aria-label={`编辑 ${section.title}`}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={saveSection.isPending}
            className="min-h-32 text-sm"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={save}
              disabled={draft.trim().length === 0 || saveSection.isPending}
            >
              {saveSection.isPending ? "保存中…" : "保存编辑"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setEditing(false)}
            >
              取消
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <button
            type="button"
            onClick={() => {
              setDraft(section.content ?? "");
              setEditing(true);
            }}
            disabled={saveSection.isPending}
            className="font-medium text-[var(--color-accent)]"
          >
            编辑内容
          </button>
          {canRegenerate && (
            <button
              type="button"
              onClick={() => regenerate.mutate(section.id)}
              disabled={regenerate.isPending}
              className="font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            >
              {regenerate.isPending ? "重做中…" : "重做本节"}
            </button>
          )}
          {regenerate.isError && (
            <p role="alert" className="text-[var(--color-error)]">
              重做失败，请重试。
            </p>
          )}
        </div>
      )}
    </li>
  );
}

interface PackDetailProps {
  projectId: string;
  pack: StudyPackDto;
  onBack: () => void;
}

function PackDetail({ projectId, pack, onBack }: PackDetailProps) {
  const generate = useGenerateStudyPack(projectId, pack.id);
  const publish = usePublishStudyPack(projectId, pack.id);
  const readyCount = pack.sections.filter(
    (section) => (section.content ?? "").trim().length > 0
  ).length;
  const failedCount = pack.sections.filter(
    (section) => section.status === "failed"
  ).length;
  const canGenerate = pack.outlineStatus === "confirmed";
  const canPublish = readyCount > 0;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <button
        type="button"
        onClick={onBack}
        className="self-start text-xs font-medium text-[var(--color-text-secondary)]"
      >
        返回资料包列表
      </button>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
          {pack.title}
        </h3>
        <OutlineBadge status={pack.outlineStatus} />
        {pack.publishedArtifactId && (
          <Link
            href={`/projects/${projectId}/artifacts`}
            className="rounded-full bg-[var(--color-accent-muted)] px-2 py-0.5 text-xs font-medium text-[var(--color-accent)]"
          >
            已发布为成果
          </Link>
        )}
      </div>
      <p className="text-xs text-[var(--color-text-secondary)]">
        章节 {pack.sections.length} · 已完成 {readyCount}
        {failedCount > 0 ? ` · 失败 ${failedCount}` : ""}
      </p>

      {pack.outlineStatus === "draft" ? (
        <OutlineEditor projectId={projectId} pack={pack} />
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--color-border-light)]">
          {pack.sections.map((section) => (
            <SectionCard
              key={section.id}
              projectId={projectId}
              pack={pack}
              section={section}
            />
          ))}
        </ul>
      )}

      {canGenerate && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            onClick={() => generate.mutate()}
            disabled={generate.isPending}
          >
            {generate.isPending ? "生成中…" : "生成全部章节"}
          </Button>
          <div aria-live="polite">
            {generate.isSuccess && (
              <p role="status" className="text-xs text-[var(--color-text-secondary)]">
                本轮生成 {generate.data.generated} 节，跳过 {generate.data.skipped} 节。
              </p>
            )}
            {generate.isError && (
              <p role="alert" className="text-xs text-[var(--color-error)]">
                生成失败，请重试。
              </p>
            )}
          </div>
        </div>
      )}

      {canPublish && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => publish.mutate()}
            disabled={publish.isPending}
          >
            {publish.isPending ? "发布中…" : "发布为成果"}
          </Button>
          <div aria-live="polite">
            {publish.isSuccess && (
              <p role="status" className="text-xs text-[var(--color-text-secondary)]">
                已发布，可在项目的成果列表中查看与导出。
              </p>
            )}
            {publish.isError && (
              <p role="alert" className="text-xs text-[var(--color-error)]">
                发布失败，请重试。
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export interface StudyPacksViewProps {
  projectId: string;
  goalId: string;
  className?: string;
}

export function StudyPacksView({
  projectId,
  goalId,
  className,
}: StudyPacksViewProps) {
  const {
    data: packs,
    isPending,
    isError,
    refetch,
  } = useStudyPacks(projectId, goalId);
  const createPack = useCreateStudyPack(projectId, goalId);
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null);
  const {
    data: selectedPack,
    isPending: packPending,
  } = useStudyPack(projectId, selectedPackId ?? undefined);

  if (isPending) {
    return (
      <div
        role="status"
        className={cn(
          "px-1 py-8 text-sm text-[var(--color-text-secondary)]",
          className
        )}
      >
        加载中…
      </div>
    );
  }

  if (isError) {
    return (
      <EmptyState
        className={className}
        title="资料包加载失败"
        description="请稍后重试。"
        action={
          <Button type="button" variant="ghost" onClick={() => refetch()}>
            重试
          </Button>
        }
      />
    );
  }

  if (selectedPackId && selectedPack) {
    return (
      <PackDetail
        projectId={projectId}
        pack={selectedPack}
        onBack={() => setSelectedPackId(null)}
      />
    );
  }

  const allPacks = packs ?? [];

  return (
    <div className={cn("flex w-full min-w-0 flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
          学习资料包
        </h2>
        <Button
          type="button"
          size="sm"
          onClick={() => createPack.mutate({})}
          disabled={createPack.isPending}
        >
          {createPack.isPending ? "创建中…" : "新建资料包"}
        </Button>
      </div>
      {createPack.isError && (
        <p role="alert" className="text-xs text-[var(--color-error)]">
          创建资料包失败，请重试。
        </p>
      )}
      {allPacks.length === 0 ? (
        <p className="text-xs text-[var(--color-text-tertiary)]">
          还没有资料包。完成知识点地图后，可以按章节生成可编辑、可导出的复习资料。
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--color-border-light)]">
          {allPacks.map((pack) => {
            const ready = pack.sections.filter(
              (section) => section.status === "ready"
            ).length;
            return (
              <li key={pack.id}>
                <button
                  type="button"
                  onClick={() => setSelectedPackId(pack.id)}
                  className="flex w-full flex-col gap-1 py-3 text-left"
                >
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm font-medium text-[var(--color-text-primary)]">
                      {pack.title}
                    </span>
                    <OutlineBadge status={pack.outlineStatus} />
                    {pack.publishedArtifactId && (
                      <span className="rounded-full bg-[var(--color-accent-muted)] px-2 py-0.5 text-xs text-[var(--color-accent)]">
                        已发布
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-[var(--color-text-secondary)]">
                    章节 {pack.sections.length} · 已完成 {ready} · 更新于{" "}
                    {new Date(pack.updatedAt).toLocaleDateString("zh-CN")}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {packPending && selectedPackId && (
        <p role="status" className="text-xs text-[var(--color-text-secondary)]">
          加载中…
        </p>
      )}
    </div>
  );
}
