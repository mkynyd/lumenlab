"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Download, Folder, PageEdit, Refresh } from "iconoir-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { SaveToProjectDialog } from "@/components/tools/save-to-project-dialog";
import { MarkdownContent } from "@/components/markdown/markdown-content";
import type { ConversionSummary } from "@/lib/api/types";
import { downloadTextFile } from "@/lib/browser/download-text-file";
import { useConversions } from "@/lib/hooks/use-conversions";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";

const MAX_PDF_SIZE = 200 * 1024 * 1024;
const COMPLETED_PROGRESS_DISMISS_MS = 1_500;

const STAGES = [
  { key: "uploading", label: "上传" },
  { key: "pending", label: "排队" },
  { key: "model", label: "解析" },
  { key: "done", label: "完成" },
] as const;

type Stage = "idle" | (typeof STAGES)[number]["key"];

interface ConversionResult {
  content: string;
  conversionId: string;
  fileName: string;
  assets: Array<{ id: string; relativePath: string }>;
  metadata?: Record<string, unknown>;
}

interface PdfConvertClientProps {
  conversions: ConversionSummary[];
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function parseEvent(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data: ")) return null;
  try {
    return JSON.parse(trimmed.slice(6)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function PdfConvertClient({ conversions }: PdfConvertClientProps) {
  useConversions(conversions);
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState<{
    extractedPages: number;
    totalPages: number;
  } | null>(null);
  const [result, setResult] = useState<ConversionResult | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileSize, setFileSize] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    message: string;
    tone: "info" | "success";
  } | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [mineruToken, setMineruToken] = useState("");
  const [showTokenInput, setShowTokenInput] = useState(false);
  const [showProjectPicker, setShowProjectPicker] = useState(false);

  const isConverting = stage !== "idle" && stage !== "done";
  const stageIndex = STAGES.findIndex((item) => item.key === stage);

  useEffect(() => {
    if (stage !== "done") return;
    const timeout = window.setTimeout(
      () => setStage("idle"),
      COMPLETED_PROGRESS_DISMISS_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [stage]);

  function validateFile(file: File) {
    if (
      !file.name.toLowerCase().endsWith(".pdf") ||
      (file.type && file.type !== "application/pdf")
    ) {
      return "请选择有效的 PDF 文件";
    }
    if (file.size > MAX_PDF_SIZE) {
      return "文件大小超过 200MB 限制，请压缩或拆分后重试";
    }
    return null;
  }

  async function startConversion(file: File, oneTimeToken?: string) {
    const validationError = validateFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSelectedFile(file);
    setFileSize(file.size);
    setStage("uploading");
    setProgress(null);
    setResult(null);
    setError(null);
    setFeedback(null);

    const formData = new FormData();
    formData.append("file", file);
    if (oneTimeToken?.trim()) {
      formData.append("mineruToken", oneTimeToken.trim());
    }

    try {
      const response = await fetch("/api/tools/pdf-to-markdown", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
          needToken?: boolean;
        } | null;
        if (response.status === 403 && body?.needToken) {
          setShowTokenInput(true);
          setStage("idle");
          setFeedback({
            message: body.error || "请输入 MinerU Token 后继续",
            tone: "info",
          });
          return;
        }
        throw new Error(body?.error || "转换失败，请稍后重试");
      }
      if (!response.body) {
        throw new Error("转换服务未返回进度流，请重试");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let receivedTerminalEvent = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const event = parseEvent(line);
          if (!event || typeof event.stage !== "string") continue;

          if (event.stage === "uploading" || event.stage === "pending") {
            setStage(event.stage);
          } else if (event.stage === "model") {
            setStage("model");
            setProgress({
              extractedPages: Number(event.extractedPages) || 0,
              totalPages: Number(event.totalPages) || 0,
            });
          } else if (event.stage === "done") {
            receivedTerminalEvent = true;
            setStage("done");
            setShowTokenInput(false);
            setResult({
              content: String(event.content || ""),
              conversionId: String(event.conversionId || ""),
              fileName: String(
                event.fileName || file.name.replace(/\.pdf$/i, ".md"),
              ),
              assets: Array.isArray(event.assets)
                ? event.assets.flatMap((asset) => {
                    if (!asset || typeof asset !== "object") return [];
                    const value = asset as Record<string, unknown>;
                    return typeof value.id === "string" &&
                      typeof value.relativePath === "string"
                      ? [{ id: value.id, relativePath: value.relativePath }]
                      : [];
                  })
                : [],
              metadata:
                event.metadata && typeof event.metadata === "object"
                  ? (event.metadata as Record<string, unknown>)
                  : undefined,
            });
            await queryClient.invalidateQueries({
              queryKey: queryKeys.conversions.all,
            });
          } else if (event.stage === "failed") {
            receivedTerminalEvent = true;
            setStage("idle");
            setError(String(event.error || "转换失败，请稍后重试"));
          }
        }
      }

      if (!receivedTerminalEvent) {
        throw new Error("转换进度流意外中断，请重试");
      }
    } catch (conversionError) {
      setStage("idle");
      setError(
        conversionError instanceof Error
          ? conversionError.message
          : "转换失败，请稍后重试",
      );
    }
  }

  function handleFile(file: File | undefined) {
    if (!file || isConverting) return;
    void startConversion(file);
  }

  function downloadContent() {
    if (!result) return;
    downloadTextFile(result.content, result.fileName);
    setFeedback({ message: "Markdown 文件已开始下载", tone: "success" });
  }

  function reset() {
    setStage("idle");
    setProgress(null);
    setResult(null);
    setSelectedFile(null);
    setFileSize(0);
    setError(null);
    setFeedback(null);
    setShowTokenInput(false);
    setMineruToken("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const pageCount = Number(result?.metadata?.pageCount) || 0;
  const resultAssetsByPath = new Map(
    (result?.assets || []).map((asset) => [asset.relativePath, asset.id]),
  );

  function resolveResultImageUrl(src: string) {
    if (!result) return src;
    const assetId = resultAssetsByPath.get(src.replace(/^\.\//, ""));
    return assetId
      ? `/api/tools/conversions/${result.conversionId}/assets/${assetId}`
      : src;
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl px-4 py-7 pb-14 sm:px-8 sm:py-10">
        <header className="max-w-2xl">
          <p className="text-xs font-medium text-[var(--color-text-tertiary)]">
            文档工具
          </p>
          <h1 className="mt-1.5 text-xl font-semibold tracking-tight">
            PDF 转 Markdown
          </h1>
          <p className="mt-1.5 max-w-[65ch] text-sm leading-6 text-[var(--color-text-secondary)]">
            转换课程讲义、论文和实验资料，保留表格、公式与图片引用。
          </p>
        </header>

        <section aria-labelledby="upload-heading" className="mt-7">
          <h2 id="upload-heading" className="sr-only">
            上传 PDF
          </h2>
          <div
            className={cn(
              "flex min-h-52 flex-col items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-8 text-center transition-[background-color,border-color,transform] duration-150 ease-out motion-reduce:transition-none",
              isDragOver &&
                "border-[var(--color-accent)] bg-[var(--color-accent-soft)]",
            )}
            onDragEnter={(event) => {
              event.preventDefault();
              if (!isConverting) setIsDragOver(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setIsDragOver(false);
              handleFile(event.dataTransfer.files[0]);
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,application/pdf"
              hidden
              disabled={isConverting}
              onChange={(event) => handleFile(event.target.files?.[0])}
            />
            <span className="flex size-10 items-center justify-center text-[var(--color-text-tertiary)]">
              {isConverting ? (
                <Spinner className="size-5" />
              ) : (
                <PageEdit width={26} height={26} strokeWidth={1.5} />
              )}
            </span>
            <p className="mt-3 text-sm font-medium text-[var(--color-text-primary)]">
              {isConverting ? "正在转换，请保持页面打开" : "拖拽 PDF 到此处"}
            </p>
            <p className="mt-1 text-xs leading-5 text-[var(--color-text-tertiary)]">
              最大 200MB，最多 200 页
            </p>
            <Button
              type="button"
              size="sm"
              className="mt-4 min-h-10 px-3 sm:min-h-0"
              disabled={isConverting}
              onClick={() => fileInputRef.current?.click()}
            >
              选择 PDF
            </Button>
          </div>

          {showTokenInput && selectedFile && (
            <div className="mt-5 flex flex-col gap-3 border-y border-[var(--color-border-light)] py-4">
              <label className="flex flex-col gap-2 text-xs font-medium text-[var(--color-text-secondary)]">
                MinerU Token
                <Input
                  type="password"
                  value={mineruToken}
                  autoComplete="off"
                  aria-describedby="mineru-token-help"
                  placeholder="输入仅用于本次转换的 Token"
                  className="h-10 font-mono sm:h-8"
                  onChange={(event) => setMineruToken(event.target.value)}
                />
              </label>
              <p
                id="mineru-token-help"
                className="text-xs leading-5 text-[var(--color-text-tertiary)]"
              >
                Token 仅用于本次转换，不会存储到服务器。
              </p>
              <div className="flex justify-end">
                <Button
                  type="button"
                  size="sm"
                  className="min-h-10 sm:min-h-0"
                  disabled={!mineruToken.trim()}
                  onClick={() =>
                    void startConversion(selectedFile, mineruToken)
                  }
                >
                  开始转换
                </Button>
              </div>
            </div>
          )}
        </section>

        {stage !== "idle" && (
          <section
            aria-label="转换进度"
            aria-live="polite"
            className="mt-6 border-y border-[var(--color-border-light)] py-4"
          >
            <ol className="grid grid-cols-4 gap-1.5">
              {STAGES.map((item, index) => {
                const complete = stageIndex > index || stage === "done";
                const current = stageIndex === index;
                return (
                  <li
                    key={item.key}
                    className="flex min-w-0 items-center gap-1.5"
                  >
                    <span
                      aria-label={
                        complete ? `${item.label}步骤已完成` : undefined
                      }
                      className={cn(
                        "flex size-5 shrink-0 items-center justify-center rounded-full text-[0.6875rem] font-semibold transition-colors duration-150 motion-reduce:transition-none",
                        complete || current
                          ? "bg-[var(--color-accent)] text-[var(--color-accent-contrast)]"
                          : "bg-[var(--color-panel-muted)] text-[var(--color-text-tertiary)]",
                      )}
                    >
                      {complete ? <Check width={12} height={12} /> : index + 1}
                    </span>
                    <span
                      className={cn(
                        "truncate text-xs",
                        stageIndex >= index
                          ? "text-[var(--color-text-primary)]"
                          : "text-[var(--color-text-tertiary)]",
                      )}
                    >
                      {item.label}
                    </span>
                    {index < STAGES.length - 1 && (
                      <Separator className="min-w-2 flex-1" />
                    )}
                  </li>
                );
              })}
            </ol>

            {stage === "model" && progress && (
              <div className="mt-4">
                <Progress
                  value={
                    progress.totalPages > 0
                      ? (progress.extractedPages / progress.totalPages) * 100
                      : 0
                  }
                  size="sm"
                  color="accent"
                  label={`已解析 ${progress.extractedPages} / ${progress.totalPages} 页`}
                />
                <p className="mt-1.5 text-xs tabular-nums text-[var(--color-text-tertiary)]">
                  已解析 {progress.extractedPages} / {progress.totalPages} 页
                </p>
              </div>
            )}
          </section>
        )}

        {error && (
          <section
            role="alert"
            className="mt-6 border-y border-[var(--color-border-light)] py-4"
          >
            <p className="text-sm leading-6 text-[var(--color-error)]">
              {error}
            </p>
            <div className="mt-2 flex flex-wrap gap-1">
              {selectedFile && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="min-h-10 sm:min-h-0"
                  onClick={() =>
                    void startConversion(selectedFile, mineruToken)
                  }
                >
                  <Refresh data-icon="inline-start" strokeWidth={1.8} />
                  重新转换
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="min-h-10 sm:min-h-0"
                onClick={reset}
              >
                选择其他文件
              </Button>
            </div>
          </section>
        )}

        {feedback && (
          <p
            role="status"
            className={cn(
              "mt-4 text-sm",
              feedback.tone === "success"
                ? "text-[var(--color-success)]"
                : "text-[var(--color-text-secondary)]",
            )}
          >
            {feedback.message}
          </p>
        )}

        {result && (
          <section className="mt-6 border-t border-[var(--color-border-light)] pt-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold">转换结果</h2>
                <p className="mt-1 truncate text-xs text-[var(--color-text-tertiary)]">
                  {result.fileName}
                </p>
              </div>
              <div className="flex flex-wrap gap-1">
                <Button asChild size="sm" className="min-h-10 sm:min-h-0">
                  <a
                    href={`/api/tools/conversions/${result.conversionId}/download`}
                  >
                    <Download data-icon="inline-start" strokeWidth={1.8} />
                    下载完整包
                  </a>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="min-h-10 sm:min-h-0"
                  onClick={downloadContent}
                >
                  <Download data-icon="inline-start" strokeWidth={1.8} />
                  下载 .md
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="min-h-10 sm:min-h-0"
                  onClick={() => setShowProjectPicker(true)}
                >
                  <Folder data-icon="inline-start" strokeWidth={1.8} />
                  保存到项目
                </Button>
              </div>
            </div>

            <div className="mt-4 max-h-[36rem] overflow-auto rounded-[var(--radius-md)] bg-[var(--color-panel-muted)] p-4 sm:p-6">
              <MarkdownContent
                content={result.content}
                resolveImageUrl={resolveResultImageUrl}
              />
            </div>
            <p className="mt-3 text-xs text-[var(--color-text-tertiary)]">
              {pageCount > 0 ? `${pageCount} 页，` : ""}
              {formatBytes(fileSize)}
            </p>
          </section>
        )}
      </div>

      {result && (
        <SaveToProjectDialog
          conversionId={result.conversionId}
          open={showProjectPicker}
          onOpenChange={setShowProjectPicker}
          onSaved={(projectName) =>
            setFeedback({
              message: `已保存到「${projectName}」`,
              tone: "success",
            })
          }
        />
      )}
    </div>
  );
}
