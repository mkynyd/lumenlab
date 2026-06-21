"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MarkdownContent } from "@/components/markdown/markdown-content";
import type { ProjectFile } from "@/components/project/file-list";

interface FileDetail extends ProjectFile {
  textContent?: string | null;
  resources?: Array<{ id: string; relativePath: string }>;
}

export function FileContentDialog({
  file,
  onClose,
  onUpdated,
}: {
  file: ProjectFile;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [detail, setDetail] = useState<FileDetail | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/files/${file.id}`)
      .then((response) => response.json())
      .then((data) => {
        setDetail(data.file);
        setDraft(data.file?.textContent || "");
      })
      .catch(() => setMessage("无法加载解析内容"));
  }, [file.id]);

  async function save() {
    const response = await fetch(`/api/files/${file.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ textContent: draft }),
    });
    const data = await response.json();
    if (!response.ok) {
      setMessage(typeof data.error === "string" ? data.error : "保存失败");
      return;
    }
    setDetail((current) =>
      current ? { ...current, textContent: draft, enhancementStatus: data.enhancementStatus } : current
    );
    setEditing(false);
    setMessage("OCR 原文已保存，检索分块已更新");
    onUpdated();
  }

  function resolveImageUrl(src: string) {
    const normalized = src.replace(/^\.\//, "");
    const resource = detail?.resources?.find(
      (item) => item.relativePath === normalized
    );
    return resource
      ? `/api/files/${file.id}/resources/${resource.id}`
      : src;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-overlay)] p-4">
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-[var(--radius-lg)] bg-[var(--color-surface)] shadow-xl">
        <div className="flex items-center justify-between px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">{file.originalName}</h2>
            <p className="text-[11px] text-[var(--color-text-tertiary)]">
              OCR 原文可编辑，修改后会更新检索分块
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex size-11 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-project-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:bg-[var(--color-project-surface-hover)] sm:size-8"
            aria-label="关闭"
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex gap-2 bg-[var(--color-panel-muted)] px-4 py-2">
          {detail?.textContent && (
            <Button
              variant="secondary"
              size="sm"
              className="text-[var(--color-text-secondary)] hover:bg-[var(--color-project-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:bg-[var(--color-project-surface-hover)]"
              onClick={() => setEditing((value) => !value)}
            >
              {editing ? "取消编辑" : "编辑原文"}
            </Button>
          )}
        </div>
        <div className="flex-1 overflow-auto p-4">
          {!detail ? (
            <p className="text-sm text-[var(--color-text-secondary)]">加载中...</p>
          ) : editing ? (
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              className="min-h-[50vh] w-full resize-y rounded-[var(--radius-md)] bg-[var(--color-panel)] p-3 font-mono text-xs outline-none focus:bg-[var(--color-project-surface-hover)]"
            />
          ) : (
            detail.textContent ? (
              <MarkdownContent
                content={detail.textContent}
                resolveImageUrl={resolveImageUrl}
              />
            ) : (
              <p className="text-sm text-[var(--color-text-secondary)]">
                没有解析内容
              </p>
            )
          )}
        </div>
        <div className="flex items-center justify-between bg-[var(--color-panel-muted)] px-4 py-3">
          <span className="text-xs text-[var(--color-text-secondary)]">{message}</span>
          {editing && (
            <Button
              variant="primary"
              size="sm"
              className="bg-[var(--color-project-action)] text-[var(--color-project-action-contrast)] hover:bg-[var(--color-project-action-hover)] focus-visible:bg-[var(--color-project-action-hover)]"
              onClick={save}
              disabled={!draft.trim()}
            >
              保存 OCR 原文
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
