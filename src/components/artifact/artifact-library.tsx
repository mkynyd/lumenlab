"use client";

import { useEffect, useState } from "react";
import { Copy, Download, Eye, Trash2, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { MermaidBlock } from "@/components/chat/mermaid-block";
import { LoadingIndicator } from "@/components/workbench/loading-indicator";
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
    <TooltipProvider>
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
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                onClick={close}
                aria-label="关闭成果库"
                variant="outline"
                size="icon"
              >
                <X size={16} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">关闭</TooltipContent>
          </Tooltip>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[280px_1fr]">
          {/* ------ Left: artifact list ------ */}
          <div className="overflow-y-auto border-b border-[var(--color-border)] p-2 md:border-b-0 md:border-r">
            {artifactsQuery.isPending ? (
              <div className="p-3">
                <LoadingIndicator
                  size="sm"
                  variant="orbit"
                  label="读取成果"
                  detail="正在同步列表"
                />
              </div>
            ) : artifacts.length === 0 ? (
              <div className="min-h-48 rounded-[var(--radius-lg)] bg-[var(--color-surface)] p-4">
                <div>
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
                    "mb-1 w-full rounded-[var(--radius-lg)] p-2.5 text-left transition-colors",
                    isSelected
                      ? "bg-[var(--color-interaction-active)]"
                      : "bg-[var(--color-surface)] hover:bg-[var(--color-interaction-hover)]"
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedId(artifact.id)}
                    className="block w-full rounded-[var(--radius-md)] text-left focus-visible:outline-none focus-visible:bg-[var(--color-interaction-hover)]"
                    aria-label={`查看成果 ${artifact.title}`}
                  >
                    <p className="truncate text-sm font-medium">{artifact.title}</p>
                    <p className="mt-0.5 text-xs text-[var(--color-text-tertiary)]">
                      {typeLabels[artifact.type] || artifact.type} · {new Date(artifact.createdAt).toLocaleDateString("zh-CN")}
                    </p>
                  </button>
                  <div className="mt-1.5 flex gap-1" onClick={(e) => e.stopPropagation()}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => setSelectedId(artifact.id)}
                          aria-label={`查看成果 ${artifact.title}`}
                        >
                          <Eye size={14} />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">查看</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button asChild variant="ghost" size="icon-xs">
                          <a
                            href={`/api/artifacts/${artifact.id}/export?format=markdown`}
                            onClick={() => markExport("md")}
                            aria-label="导出 Markdown"
                          >
                            <Download size={14} />
                          </a>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">下载 MD</TooltipContent>
                    </Tooltip>
                    <AlertDialog>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <AlertDialogTrigger asChild>
                            <Button
                              type="button"
                              variant="danger"
                              size="icon-xs"
                              aria-label={`删除成果 ${artifact.title}`}
                            >
                              <Trash2 size={14} />
                            </Button>
                          </AlertDialogTrigger>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">删除</TooltipContent>
                      </Tooltip>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>删除成果</AlertDialogTitle>
                          <AlertDialogDescription>
                            确定要删除「{artifact.title}」吗？这个 Markdown 成果将无法恢复。
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>取消</AlertDialogCancel>
                          <AlertDialogAction
                            variant="destructive"
                            onClick={() => void remove(artifact.id)}
                          >
                            删除
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              );
            })}
          </div>
          {/* ------ Right: detail preview ------ */}
          <div className="min-w-0 overflow-y-auto bg-[var(--color-bg)] p-4">
            {artifactQuery.isPending && selectedId ? (
              <div className="flex min-h-60 items-center justify-center">
                <LoadingIndicator
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
                <div className="workbench-readable markdown-body break-words rounded-[var(--radius-lg)] border border-[var(--color-border-light)] bg-[var(--color-panel)] p-4">
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
              <div className="flex min-h-60 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--color-panel)] p-4 text-center">
                <p className="text-sm text-[var(--color-text-tertiary)]">选择一个成果查看内容和导出选项</p>
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
    </TooltipProvider>
  );
}
