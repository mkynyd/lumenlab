"use client";

import { useEffect, useState } from "react";
import { Copy, Download, Eye, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useArtifact,
  useDeleteArtifact,
  useProjectArtifacts,
} from "@/lib/hooks/use-artifacts";

export function ArtifactLibrary({
  projectId,
  refreshKey,
  onClose,
}: {
  projectId: string;
  refreshKey: number;
  onClose: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const artifactsQuery = useProjectArtifacts(projectId);
  const artifactQuery = useArtifact(selectedId);
  const deleteArtifact = useDeleteArtifact(projectId);
  const artifacts = artifactsQuery.data || [];
  const selected = artifactQuery.data || null;
  const { refetch: refetchArtifacts } = artifactsQuery;

  useEffect(() => {
    if (refreshKey > 0) void refetchArtifacts();
  }, [refetchArtifacts, refreshKey]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setVisible(true), 0);
    return () => window.clearTimeout(timeoutId);
  }, []);

  function close() {
    setVisible(false);
    window.setTimeout(onClose, 300);
  }

  async function remove(id: string) {
    if (!confirm("确定删除这个成果吗？")) return;
    await deleteArtifact.mutateAsync(id);
    if (selectedId === id) setSelectedId(undefined);
  }

  async function copy(content: string) {
    await navigator.clipboard.writeText(content);
    setMessage("Markdown 已复制");
  }

  return (
    <div
      className={`fixed inset-0 z-40 flex justify-end bg-black/30 transition-opacity duration-300 ease-out motion-reduce:transition-none ${
        visible ? "opacity-100" : "opacity-0"
      }`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        className={`flex h-full w-full max-w-2xl flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${
          visible ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">成果库</h2>
            <p className="text-[11px] text-[var(--color-text-tertiary)]">Markdown 为唯一内容源</p>
          </div>
          <button onClick={close} aria-label="关闭成果库"><X size={16} /></button>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-[240px_1fr]">
          <div className="overflow-y-auto border-r border-[var(--color-border)] p-2">
            {artifacts.length === 0 ? (
              <p className="p-3 text-xs text-[var(--color-text-tertiary)]">暂无成果</p>
            ) : artifacts.map((artifact) => (
              <div key={artifact.id} className="mb-1 rounded border border-[var(--color-border-light)] p-2">
                <p className="truncate text-xs font-medium">{artifact.title}</p>
                <p className="text-[10px] text-[var(--color-text-tertiary)]">{artifact.type} · {new Date(artifact.createdAt).toLocaleDateString("zh-CN")}</p>
                <div className="mt-1 flex gap-1">
                  <button onClick={() => setSelectedId(artifact.id)} aria-label="查看成果"><Eye size={12} /></button>
                  <a href={`/api/artifacts/${artifact.id}/export?format=markdown`} aria-label="导出 Markdown"><Download size={12} /></a>
                  <button onClick={() => remove(artifact.id)} aria-label="删除成果"><Trash2 size={12} /></button>
                </div>
              </div>
            ))}
          </div>
          <div className="min-w-0 overflow-y-auto p-4">
            {selected ? (
              <>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <h3 className="mr-auto text-sm font-semibold">{selected.title}</h3>
                  <Button variant="ghost" size="sm" onClick={() => copy(selected.content)}><Copy size={12} />复制</Button>
                  {(["markdown", "docx", "pdf"] as const).map((format) => (
                    <a key={format} href={`/api/artifacts/${selected.id}/export?format=${format}`}>
                      <Button variant="ghost" size="sm">{format === "markdown" ? "MD" : format.toUpperCase()}</Button>
                    </a>
                  ))}
                </div>
                <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">{selected.content}</pre>
              </>
            ) : (
              <p className="text-sm text-[var(--color-text-tertiary)]">选择一个成果查看内容和导出选项</p>
            )}
          </div>
        </div>
        {message && <div className="border-t border-[var(--color-border)] px-4 py-2 text-xs">{message}</div>}
      </div>
    </div>
  );
}
