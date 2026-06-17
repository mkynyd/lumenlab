"use client";

import { useEffect, useState } from "react";
import { Copy, Download, Eye, Trash2, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import { Button } from "@/components/ui/button";
import { MermaidBlock } from "@/components/chat/mermaid-block";
import { AmbientField } from "@/components/workbench/ambient-field";
import { MathCurveLoader } from "@/components/workbench/math-curve-loader";
import { cn } from "@/lib/utils";
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

  function markExport(format: string) {
    setMessage(`正在导出 ${format.toUpperCase()}`);
  }

  const typeLabels: Record<string, string> = {
    experiment_report: "实验报告",
    general: "通用成果",
    notes: "笔记",
    summary: "总结",
    analysis: "分析",
    code_explanation: "代码解释",
    review_notes: "复习笔记",
    exam_analysis: "试卷分析",
    error_review: "错题解析",
    quick_reference: "速记版",
    mermaid: "思维导图",
    other: "其他",
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex justify-end bg-[var(--color-overlay)] transition-opacity duration-300 ease-out motion-reduce:transition-none ${
        visible ? "opacity-100" : "opacity-0"
      }`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
	        className={`flex h-full w-full max-w-4xl flex-col border-l border-[var(--color-border-light)] bg-[var(--color-panel)] shadow-[var(--shadow-float)] backdrop-blur-[var(--glass-blur)] transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${
          visible ? "translate-x-0" : "translate-x-full"
        }`}
      >
	        <div className="flex min-h-14 items-center justify-between border-b border-[var(--color-border-light)] px-4 py-3">
          <div>
            <h2 className="text-base font-semibold">成果库</h2>
            <p className="text-xs text-[var(--color-text-tertiary)]">保存、阅读和导出 AI 生成成果</p>
          </div>
          <button
            onClick={close}
            aria-label="关闭成果库"
            className="inline-flex size-8 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
          >
            <X size={16} />
          </button>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[280px_1fr]">
          {/* ------ Left: artifact list ------ */}
          <div className="overflow-y-auto border-b border-[var(--color-border)] p-2 md:border-b-0 md:border-r">
            {artifactsQuery.isPending ? (
              <div className="p-3">
                <MathCurveLoader
                  size="sm"
                  variant="orbit"
                  label="读取成果"
                  detail="正在同步列表"
                />
              </div>
            ) : artifacts.length === 0 ? (
              <div className="relative min-h-48 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border-light)] bg-[var(--color-surface)] p-4">
	                <AmbientField density="compact" className="opacity-60" />
                <div className="relative">
                  <p className="text-sm font-medium text-[var(--color-text-primary)]">暂无成果</p>
                  <p className="mt-1 text-xs leading-relaxed text-[var(--color-text-tertiary)]">
                    在助手回答下方点击「保存为成果」，这里会保留 Markdown 源内容和导出入口。
                  </p>
                </div>
              </div>
            ) : artifacts.map((artifact) => {
              const isSelected = selectedId === artifact.id;
              return (
                <div
                  key={artifact.id}
                  className={cn(
                    "mb-1 w-full rounded-[var(--radius-lg)] border p-2.5 text-left transition-colors",
                    isSelected
                      ? "workbench-glow border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
                      : "border-[var(--color-border-light)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)]"
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedId(artifact.id)}
                    className="block w-full rounded-[var(--radius-md)] text-left focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] focus-visible:outline-offset-2"
                    aria-label={`查看成果 ${artifact.title}`}
                  >
                    <p className="truncate text-sm font-medium">{artifact.title}</p>
                    <p className="mt-0.5 text-xs text-[var(--color-text-tertiary)]">
                      {typeLabels[artifact.type] || artifact.type} · {new Date(artifact.createdAt).toLocaleDateString("zh-CN")}
                    </p>
                  </button>
                  <div className="mt-1.5 flex gap-1" onClick={(e) => e.stopPropagation()}>
                    <button className="rounded-[var(--radius-sm)] p-1 hover:bg-[var(--color-surface-hover)]" onClick={() => setSelectedId(artifact.id)} aria-label={`查看成果 ${artifact.title}`} title="查看">
                      <Eye size={14} />
                    </button>
                    <a className="rounded-[var(--radius-sm)] p-1 hover:bg-[var(--color-surface-hover)]" href={`/api/artifacts/${artifact.id}/export?format=markdown`} onClick={() => markExport("md")} aria-label="导出 Markdown" title="下载 MD">
                      <Download size={14} />
                    </a>
                    <button className="rounded-[var(--radius-sm)] p-1 hover:bg-[var(--color-error-muted)] hover:text-[var(--color-error)]" onClick={() => remove(artifact.id)} aria-label="删除成果" title="删除">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          {/* ------ Right: detail preview ------ */}
          <div className="min-w-0 overflow-y-auto bg-[var(--color-bg)] p-4">
            {artifactQuery.isPending && selectedId ? (
              <div className="flex min-h-60 items-center justify-center">
                <MathCurveLoader
                  size="md"
                  variant="lissajous"
                  label="打开成果"
                  detail="正在渲染 Markdown"
                />
              </div>
            ) : selected ? (
              <>
                <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] pb-3">
                  <h3 className="mr-auto text-base font-semibold">{selected.title}</h3>
                  <Button variant="ghost" size="sm" onClick={() => copy(selected.content)}><Copy size={14} />复制</Button>
                  {(["markdown", "docx", "pdf"] as const).map((format) => (
                    <a
                      key={format}
                      href={`/api/artifacts/${selected.id}/export?format=${format}`}
                      onClick={() => markExport(format)}
                    >
                      <Button variant="ghost" size="sm">{format === "markdown" ? "MD" : format.toUpperCase()}</Button>
                    </a>
                  ))}
                </div>
                <div className="workbench-readable prose-sm break-words rounded-[var(--radius-lg)] border border-[var(--color-border-light)] bg-[var(--color-panel)] p-4">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkMath]}
                    rehypePlugins={[rehypeKatex, rehypeHighlight]}
                    components={{
                      code(props) {
                        const { className, children, ...rest } = props;
                        const match = /language-(\w+)/.exec(className || "");
                        const code = String(children).replace(/\n$/, "");
                        if (match?.[1] === "mermaid") {
                          return <MermaidBlock code={code} />;
                        }
                        return (
                          <code className={className} {...rest}>
                            {children}
                          </code>
                        );
                      },
                    }}
                  >
                    {selected.content}
                  </ReactMarkdown>
                </div>
              </>
            ) : (
              <div className="relative flex min-h-60 items-center justify-center overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border-light)] bg-[var(--color-panel)] p-4 text-center">
	                <AmbientField density="compact" className="opacity-60" />
                <p className="relative text-sm text-[var(--color-text-tertiary)]">选择一个成果查看内容和导出选项</p>
              </div>
            )}
          </div>
        </div>
        {message && (
          <div className="border-t border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-success)]">
            {message}
          </div>
        )}
      </div>
    </div>
  );
}
