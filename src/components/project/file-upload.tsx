"use client";

import { useState, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Upload, X } from "lucide-react";
import { useUploadFile } from "@/lib/hooks/use-project-files";

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
  ".pdf",
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp",
];

export function FileUpload({ projectId, onUploaded, className }: FileUploadProps) {
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadMutation = useUploadFile(projectId);

  const uploadFile = useCallback(
    async (file: File) => {
      setError(null);

      try {
        await uploadMutation.mutateAsync(file);
        onUploaded();
      } catch (err) {
        setError(err instanceof Error ? err.message : "上传失败，请重试");
      }
    },
    [onUploaded, uploadMutation]
  );

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (files && files.length > 0) {
      uploadFile(files[0]);
    }
    // Reset input so same file can be re-uploaded
    e.target.value = "";
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      uploadFile(files[0]);
    }
  }

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
          "flex flex-col items-center justify-center py-4 px-3 rounded-[var(--radius-md)]",
          "border border-dashed cursor-pointer transition-colors duration-150",
          dragging
            ? "border-[var(--color-accent)] bg-[var(--color-accent-muted)]"
            : "border-[var(--color-border)] hover:border-[var(--color-text-tertiary)]"
        )}
        onClick={() => inputRef.current?.click()}
      >
        {uploadMutation.isPending ? (
          <span className="text-xs text-[var(--color-text-secondary)]">
            上传中…
          </span>
        ) : (
          <>
            <Upload size={16} strokeWidth={1.5} className="text-[var(--color-text-tertiary)] mb-1" />
            <span className="text-xs text-[var(--color-text-tertiary)]">
              点击或拖拽文件上传（≤10MB）
            </span>
            <span className="text-[10px] text-[var(--color-text-tertiary)] mt-0.5">
              支持 TXT、MD、CSV、JSON、代码文件、PDF、图片
            </span>
          </>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-1 text-xs text-[var(--color-error)]">
          <X size={12} strokeWidth={2} />
          {error}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={ALLOWED_TYPES.join(",")}
        onChange={handleChange}
      />
    </div>
  );
}
