"use client";

import { useState, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Upload, AlertCircle, Check } from "lucide-react";
import { useUploadFiles } from "@/lib/hooks/use-project-files";
import { MathCurveLoader } from "@/components/workbench/math-curve-loader";

interface FileUploadProps {
  projectId: string;
  onUploaded: () => void;
  className?: string;
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

export function FileUpload({ projectId, onUploaded, className }: FileUploadProps) {
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
    <div className={cn("space-y-2", className)}>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={cn(
          "flex flex-col items-center justify-center rounded-[var(--radius-xl)] px-3 py-4",
          "border border-dashed cursor-pointer transition-[background-color,border-color,box-shadow] duration-150",
          "bg-[var(--color-surface)]",
          dragging
            ? "workbench-border-glow border-[var(--color-accent)] bg-[var(--color-accent-muted)]"
            : "border-[var(--color-border-light)] hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-soft)]"
        )}
        onClick={() => inputRef.current?.click()}
      >
        {uploading ? (
          <MathCurveLoader
            size="sm"
            variant="orbit"
            label="上传中"
            detail="准备进入解析队列"
          />
        ) : (
          <>
            <Upload size={16} strokeWidth={1.5} className="text-[var(--color-text-tertiary)] mb-1" />
            <span className="text-xs font-medium text-[var(--color-text-secondary)]">
              点击或拖拽文件上传（≤20MB，支持批量）
            </span>
            <span className="text-[10px] text-[var(--color-text-tertiary)] mt-0.5">
              支持 Office、WPS、iWork、PDF、图片、文本/代码
            </span>
          </>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-1 text-xs text-[var(--color-error)]">
          <AlertCircle size={12} strokeWidth={2} className="shrink-0 mt-0.5" />
          <span className="leading-relaxed">{error}</span>
        </div>
      )}

      {uploadMutation.data && uploadMutation.data.errors.length === 0 && uploadMutation.data.files.length > 0 && !uploading && (
        <div className="flex items-center gap-1 text-xs text-[var(--color-success)]">
          <Check size={12} strokeWidth={2} />
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
    </div>
  );
}
