"use client";

import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { createIdempotencyKey } from "@/lib/hooks/use-learning-api";
import type { LearningMaterialMode } from "@/lib/hooks/use-learning-api";
import {
  useConfirmScope,
  useLearningScope,
  useSaveScopeDraft,
} from "@/lib/hooks/use-learning-goals";
import { useProjectFiles } from "@/lib/hooks/use-project-files";
import { friendlyLearningError } from "@/components/learning/learning-error";

export interface ScopePanelProps {
  projectId: string;
  goalId: string;
  onConfirmed?: () => void;
}

function scopeNote(definition: Record<string, unknown> | undefined): string {
  const note = definition?.note;
  return typeof note === "string" ? note : "";
}

/**
 * Learning-scope editor: pick the material mode (whole readable corpus or a
 * subset of parsed files), save drafts with optimistic-concurrency versions,
 * and confirm the scope. A confirmed scope renders as a read-only summary
 * with its material gaps.
 */
export function ScopePanel({ projectId, goalId, onConfirmed }: ScopePanelProps) {
  const scopeQuery = useLearningScope(projectId, goalId);
  const filesQuery = useProjectFiles(projectId);
  const saveDraft = useSaveScopeDraft(projectId, goalId);
  const confirmScope = useConfirmScope(projectId, goalId);

  const scope = scopeQuery.data ?? null;
  const selectableFiles = (filesQuery.data ?? []).filter(
    (file) => file.status === "parsed" || file.status === "partial"
  );

  const [materialMode, setMaterialMode] =
    useState<LearningMaterialMode>("project_corpus");
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [note, setNote] = useState("");

  // Echo the loaded scope into the editable state. Adjusting state during
  // render (the React-docs pattern) avoids a cascading effect; React Query
  // keeps data identity stable across refetches of equal data, so this only
  // re-syncs when the scope actually changes. Starts null so the first
  // arriving scope always syncs once.
  const [syncedScope, setSyncedScope] = useState<typeof scope>(null);
  if (scope !== syncedScope) {
    setSyncedScope(scope);
    if (scope) {
      setMaterialMode(scope.materialMode);
      setSelectedFileIds(scope.fileIds);
      setNote(scopeNote(scope.definition));
    }
  }

  const draftKeyRef = useRef<{ key: string; signature: string } | null>(null);
  const confirmKeyRef = useRef<{ key: string; signature: string } | null>(
    null
  );
  const fieldId = useId();

  const busy = saveDraft.isPending || confirmScope.isPending;
  const mutationError = saveDraft.error ?? confirmScope.error;

  function toggleFile(fileId: string) {
    setSelectedFileIds((previous) =>
      previous.includes(fileId)
        ? previous.filter((id) => id !== fileId)
        : [...previous, fileId]
    );
  }

  function handleSaveDraft() {
    if (busy) return;
    const variables = {
      expectedVersion: scope?.version ?? 0,
      materialMode,
      fileIds: materialMode === "selected_files" ? selectedFileIds : [],
      definition: note.trim() ? { note: note.trim() } : {},
      materialGaps: scope?.materialGaps ?? [],
    };
    // Same values retry with the same key; editing after a failed save is a
    // new logical request and must use a fresh key.
    const signature = JSON.stringify(variables);
    if (!draftKeyRef.current || draftKeyRef.current.signature !== signature) {
      draftKeyRef.current = { key: createIdempotencyKey(), signature };
    }
    saveDraft.mutate(
      {
        ...variables,
        idempotencyKey: draftKeyRef.current.key,
      },
      {
        onSuccess: () => {
          draftKeyRef.current = null;
        },
      }
    );
  }

  const isDraft = scope?.status === "draft";
  const selectionValid =
    materialMode === "project_corpus" || selectedFileIds.length > 0;
  const canConfirm = isDraft && selectionValid && !busy;

  function handleConfirm() {
    if (!canConfirm || !scope) return;
    const variables = { expectedVersion: scope.version };
    const signature = JSON.stringify(variables);
    if (
      !confirmKeyRef.current ||
      confirmKeyRef.current.signature !== signature
    ) {
      confirmKeyRef.current = { key: createIdempotencyKey(), signature };
    }
    confirmScope.mutate(
      { ...variables, idempotencyKey: confirmKeyRef.current.key },
      {
        onSuccess: () => {
          confirmKeyRef.current = null;
          onConfirmed?.();
        },
      }
    );
  }

  if (scope?.status === "confirmed") {
    const confirmedNote = scopeNote(scope.definition);
    return (
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium text-[var(--color-text-primary)]">
            学习范围
          </h2>
          <span className="inline-flex items-center rounded-full bg-[var(--color-success-muted)] px-2 py-0.5 text-xs font-medium text-[var(--color-success)]">
            已确认
          </span>
        </div>
        <p className="text-sm text-[var(--color-text-secondary)]">
          {scope.materialMode === "project_corpus"
            ? "全部可读资料"
            : `选定资料（${scope.fileIds.length} 份）`}
        </p>
        {confirmedNote && (
          <p className="text-sm text-[var(--color-text-secondary)]">
            补充说明：{confirmedNote}
          </p>
        )}
        {scope.materialGaps.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-[var(--color-text-primary)]">
              资料缺口
            </h3>
            <ul className="mt-1 flex flex-col gap-1">
              {scope.materialGaps.map((gap) => (
                <li
                  key={gap}
                  className="flex items-center gap-1.5 text-sm text-[var(--color-text-secondary)]"
                >
                  <span
                    aria-hidden="true"
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-warning)]"
                  />
                  {gap}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-sm font-medium text-[var(--color-text-primary)]">
        学习范围
      </h2>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm text-[var(--color-text-secondary)]">
          学习素材
        </legend>
        <div>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--color-text-primary)]">
            <input
              type="radio"
              name={`${fieldId}-material-mode`}
              checked={materialMode === "project_corpus"}
              onChange={() => setMaterialMode("project_corpus")}
              className="accent-[var(--color-accent)]"
            />
            全部可读资料
          </label>
          <p className="mt-0.5 pl-6 text-xs text-[var(--color-text-tertiary)]">
            不单独选择文件时，项目内全部可读资料都会纳入学习范围。
          </p>
        </div>
        <div>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--color-text-primary)]">
            <input
              type="radio"
              name={`${fieldId}-material-mode`}
              checked={materialMode === "selected_files"}
              onChange={() => setMaterialMode("selected_files")}
              className="accent-[var(--color-accent)]"
            />
            选定资料
          </label>
          {materialMode === "selected_files" && (
            <div className="mt-1 pl-6">
              {filesQuery.isError ? (
                <p className="text-xs text-[var(--color-text-tertiary)]">
                  资料列表暂时无法读取，请稍后刷新重试。
                </p>
              ) : selectableFiles.length > 0 ? (
                <ul className="flex flex-col gap-1.5">
                  {selectableFiles.map((file) => (
                    <li key={file.id}>
                      <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--color-text-primary)]">
                        <input
                          type="checkbox"
                          checked={selectedFileIds.includes(file.id)}
                          onChange={() => toggleFile(file.id)}
                          className="accent-[var(--color-accent)]"
                        />
                        {file.originalName}
                      </label>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-[var(--color-text-tertiary)]">
                  暂无可选资料，请先上传并等待解析完成。
                </p>
              )}
            </div>
          )}
        </div>
      </fieldset>

      <div>
        <label
          htmlFor={`${fieldId}-note`}
          className="mb-1 block text-sm text-[var(--color-text-secondary)]"
        >
          补充说明
        </label>
        <Textarea
          id={`${fieldId}-note`}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="想侧重的章节或主题（可选）"
        />
      </div>

      {materialMode === "selected_files" && selectedFileIds.length === 0 && (
        <p className="text-xs text-[var(--color-text-tertiary)]">
          请先选择至少一份资料
        </p>
      )}

      {mutationError && (
        <p role="alert" className="text-sm text-[var(--color-error)]">
          {friendlyLearningError(mutationError)}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={handleSaveDraft}
          disabled={busy}
        >
          {saveDraft.isPending ? "保存中…" : "保存草稿"}
        </Button>
        <Button type="button" onClick={handleConfirm} disabled={!canConfirm}>
          {confirmScope.isPending ? "确认中…" : "确认学习范围"}
        </Button>
      </div>
    </section>
  );
}
