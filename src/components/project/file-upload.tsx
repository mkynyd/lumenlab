"use client";

import { useState, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Check, CloudUpload, WarningTriangle } from "iconoir-react";
import { useUploadFiles } from "@/lib/hooks/use-project-files";
import { LoadingIndicator } from "@/components/workbench/loading-indicator";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface FileUploadProps {
  projectId: string;
  onUploaded: () => void;
  className?: string;
  triggerClassName?: string;
}

const ALLOWED_TYPES = [
  ".txt", ".md", ".csv", ".json",
  ".ts", ".tsx", ".js", ".jsx", ".py",
  ".c", ".cpp", ".h", ".java", ".sql",
  ".html", ".css",
  ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".wps", ".et", ".dps", ".pages", ".numbers", ".key",
  ".pdf",
  ".png", ".jpg", ".jpeg", ".webp",
];

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

export function FileUpload({
  projectId,
  onUploaded,
  className,
  triggerClassName,
}: FileUploadProps) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadMutation = useUploadFiles(projectId);

  const uploadFiles = useCallback(
    async (files: File[]) => {
      setError(null);

      // Validate each file size on client side
      const oversized = files.filter((f) => f.size > MAX_FILE_SIZE);
      if (oversized.length > 0) {
        setError(
          `超过 20MB 限制: ${oversized.map((f) => f.name).join(", ")}`
        );
        return;
      }

      try {
        const result = await uploadMutation.mutateAsync(files);
        if (result.errors.length > 0) {
          const errorMsgs = result.errors.map(
            (e) => `${e.name}: ${e.error}`
          );
          setError(errorMsgs.join("; "));
        }
        if (result.files.length > 0) {
          onUploaded();
          setOpen(false);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "上传失败，请重试");
      }
    },
    [onUploaded, uploadMutation]
  );

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      uploadFiles(files);
    }
    // Reset input so same files can be re-uploaded
    e.target.value = "";
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      uploadFiles(files);
    }
  }

  const uploading = uploadMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <TooltipProvider delayDuration={500}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DialogTrigger asChild>
              <Button
                type="button"
                variant="secondary"
                size="icon-sm"
                className={cn(
                  "shrink-0 bg-[var(--color-project-control)] text-[var(--color-text-secondary)] hover:bg-[var(--color-project-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:bg-[var(--color-project-surface-hover)]",
                  triggerClassName
                )}
                aria-label="上传资料"
              >
                <CloudUpload strokeWidth={2} />
              </Button>
            </DialogTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">上传资料</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DialogContent className={cn("max-w-[min(920px,calc(100vw-2rem))] sm:max-w-[920px]", className)}>
        <DialogHeader>
          <DialogTitle>上传资料</DialogTitle>
          <DialogDescription>
            支持批量上传，单个文件不超过 20MB。
          </DialogDescription>
        </DialogHeader>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={cn(
            "flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-[var(--radius-lg)] px-4 py-6 text-center",
            "transition-[background-color] duration-150",
            dragging
              ? "bg-[var(--color-project-surface-active)]"
              : "bg-[var(--color-project-control)] hover:bg-[var(--color-project-surface-hover)]"
          )}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? (
            <LoadingIndicator
              size="sm"
              variant="orbit"
              label="上传中"
              detail="准备进入解析队列"
            />
          ) : (
            <>
              <CloudUpload
                width={18}
                height={18}
                strokeWidth={1.7}
                className="mb-2 text-[var(--color-text-tertiary)]"
              />
              <span className="text-sm font-medium text-[var(--color-text-primary)]">
                点击选择文件，或拖入此区域
              </span>
              <span className="mt-1 text-xs text-[var(--color-text-tertiary)]">
                Office、WPS、iWork、PDF、图片、文本/代码
              </span>
            </>
          )}
        </div>

        {error && (
          <div className="flex items-start gap-1 text-xs text-[var(--color-error)]">
            <WarningTriangle width={12} height={12} strokeWidth={2} className="mt-0.5 shrink-0" />
            <span className="leading-relaxed">{error}</span>
          </div>
        )}

        {uploadMutation.data &&
          uploadMutation.data.errors.length === 0 &&
          uploadMutation.data.files.length > 0 &&
          !uploading && (
            <div className="flex items-center gap-1 text-xs text-[var(--color-success)]">
              <Check width={12} height={12} strokeWidth={2} />
              已上传 {uploadMutation.data.files.length} 个文件
            </div>
          )}

        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept={ALLOWED_TYPES.join(",")}
          multiple
          onChange={handleChange}
        />
      </DialogContent>
    </Dialog>
  );
}
