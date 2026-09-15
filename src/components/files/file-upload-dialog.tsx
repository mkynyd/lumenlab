"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CloudUpload } from "iconoir-react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FILE_CATEGORIES, type FileCategory } from "@/lib/file-categories";
import { useUploadFiles } from "@/lib/hooks/use-project-files";
import { useProjects } from "@/lib/hooks/use-projects";
import { validateUploadBatch } from "@/lib/files/file-upload-policy";
import { errorMessage } from "@/lib/api/client";

interface FileUploadDialogProps {
  trigger: React.ReactNode;
  /** 从某个项目进入时预选该项目。 */
  defaultProjectId?: string;
}

/**
 * 资料页的上传入口：项目是文件的归属边界，所以上传必须先指定项目，
 * 分类同样必填（上传接口本身要求，缺一不可）。
 */
export function FileUploadDialog({
  trigger,
  defaultProjectId,
}: FileUploadDialogProps) {
  const queryClient = useQueryClient();
  const projectsQuery = useProjects();
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState(defaultProjectId ?? "");
  const [category, setCategory] = useState<FileCategory | "">("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    succeeded: number;
    failed: number;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const uploadMutation = useUploadFiles(projectId);

  function reset() {
    setFiles([]);
    setError(null);
    setResult(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      reset();
      if (!defaultProjectId) setProjectId("");
      setCategory("");
    }
  }

  function handleFiles(next: FileList | null) {
    setError(null);
    setResult(null);
    const picked = next ? Array.from(next) : [];
    if (picked.length === 0) {
      setFiles([]);
      return;
    }
    // 与服务端共用同一套扩展名/大小规则，避免上传后才失败。
    const batch = validateUploadBatch(picked);
    if (!batch.ok) {
      setError(batch.error);
      setFiles([]);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setFiles(picked);
  }

  const canSubmit = Boolean(projectId && category && files.length > 0);

  async function submit() {
    if (!canSubmit || !category) return;
    setError(null);
    try {
      const response = await uploadMutation.mutateAsync({
        files,
        category: category as FileCategory,
      });
      setResult({
        succeeded: response.summary.succeeded,
        failed: response.summary.failed,
      });
      setFiles([]);
      if (inputRef.current) inputRef.current.value = "";
      queryClient.invalidateQueries({ queryKey: ["files"] });
    } catch (uploadError) {
      setError(errorMessage(uploadError, "上传失败，请稍后重试"));
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>上传资料</DialogTitle>
          <DialogDescription>
            选择归属项目与分类，上传完成后会自动进入解析队列。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs text-[var(--color-text-secondary)]">
              归属项目
            </label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger
                className="h-9 w-full rounded-[var(--radius-md)] bg-[var(--color-project-control)] text-sm"
                aria-label="选择归属项目"
              >
                <SelectValue placeholder="选择一个项目" />
              </SelectTrigger>
              <SelectContent>
                {(projectsQuery.data ?? []).map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-[var(--color-text-secondary)]">
              文件分类
            </label>
            <Select
              value={category}
              onValueChange={(value) => setCategory(value as FileCategory)}
            >
              <SelectTrigger
                className="h-9 w-full rounded-[var(--radius-md)] bg-[var(--color-project-control)] text-sm"
                aria-label="选择文件分类"
              >
                <SelectValue placeholder="选择分类" />
              </SelectTrigger>
              <SelectContent>
                {FILE_CATEGORIES.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-[var(--color-text-secondary)]">
              选择文件
            </label>
            <input
              ref={inputRef}
              type="file"
              multiple
              onChange={(event) => handleFiles(event.target.files)}
              className="block w-full cursor-pointer rounded-[var(--radius-md)] bg-[var(--color-project-control)] px-3 py-2 text-xs text-[var(--color-text-secondary)] file:mr-3 file:rounded-full file:border-0 file:bg-[var(--color-panel)] file:px-3 file:py-1 file:text-xs file:text-[var(--color-text-primary)]"
            />
            {files.length > 0 && (
              <p className="text-xs text-[var(--color-text-tertiary)]">
                已选择 {files.length} 个文件
              </p>
            )}
          </div>

          {error && (
            <p role="alert" className="text-xs text-[var(--color-error)]">
              {error}
            </p>
          )}

          {result && (
            <p
              role="status"
              className="rounded-[var(--radius-md)] bg-[var(--color-success-muted)] px-3 py-2 text-xs text-[var(--color-success)]"
            >
              已上传 {result.succeeded} 个文件
              {result.failed > 0 ? `，${result.failed} 个失败` : ""}
              ，解析完成后会出现在列表里。
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleOpenChange(false)}
            >
              关闭
            </Button>
            <Button
              size="sm"
              disabled={!canSubmit || uploadMutation.isPending}
              onClick={() => void submit()}
            >
              <CloudUpload width={15} height={15} strokeWidth={1.8} />
              {uploadMutation.isPending ? "上传中…" : "上传"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
