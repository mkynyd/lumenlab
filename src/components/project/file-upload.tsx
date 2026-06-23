"use client";

import { useState, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Check, CloudUpload, WarningTriangle } from "iconoir-react";
import { FILE_CATEGORIES, type FileCategory } from "@/lib/file-categories";
import { useUploadFiles } from "@/lib/hooks/use-project-files";
import { LoadingIndicator } from "@/components/workbench/loading-indicator";
import { Button } from "@/components/ui/button";
import { Stepper } from "@/components/ui/stepper";
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
  ".pdf",
  ".png", ".jpg", ".jpeg", ".webp",
];

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

const CATEGORY_DESCRIPTIONS: Record<FileCategory, string> = {
  试卷: "考试、测验、习题集等题目材料",
  作业: "需要完成的作业与课后练习",
  课件: "教师上课使用的 PPT 课件、讲义型幻灯",
  讲义: "教材章节、补充阅读、学习笔记",
  实验: "实验指导书、实验报告、实验数据",
  代码: "源码、脚本、代码示例与作业代码",
};

export function FileUpload({
  projectId,
  onUploaded,
  className,
  triggerClassName,
}: FileUploadProps) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [step, setStep] = useState(0);
  const [category, setCategory] = useState<FileCategory | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadMutation = useUploadFiles(projectId);

  const resetState = useCallback(() => {
    setStep(0);
    setCategory(null);
    setError(null);
    setDragging(false);
  }, []);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) resetState();
  }

  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (!category) {
        setError("请先选择文件分类");
        setStep(0);
        return;
      }
      setError(null);

      const oversized = files.filter((f) => f.size > MAX_FILE_SIZE);
      if (oversized.length > 0) {
        setError(
          `超过 20MB 限制: ${oversized.map((f) => f.name).join(", ")}`
        );
        return;
      }

      try {
        const result = await uploadMutation.mutateAsync({ files, category });
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
    [category, onUploaded, uploadMutation]
  );

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      uploadFiles(files);
    }
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

  const steps = [
    {
      id: "category",
      title: "选择分类",
      description: "先告诉 AI 这是哪类资料",
      isValid: category !== null,
      content: (
        <div className="grid grid-cols-2 gap-2 py-2">
          {FILE_CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              aria-pressed={category === c}
              className={cn(
                "min-h-14 text-left p-3 rounded-[var(--radius-md)] transition-colors duration-150 focus-visible:outline-none focus-visible:bg-[var(--color-project-surface-active)]",
                category === c
                  ? "bg-[var(--color-accent-muted)]"
                  : "bg-[var(--color-project-control)] hover:bg-[var(--color-project-surface-hover)]"
              )}
            >
              <span
                className={cn(
                  "text-sm",
                  category === c
                    ? "font-semibold text-[var(--color-accent)]"
                    : "font-medium text-[var(--color-text-primary)]"
                )}
              >
                {c}
              </span>
              <p className="mt-0.5 text-[11px] text-[var(--color-text-tertiary)] line-clamp-2 leading-relaxed">
                {CATEGORY_DESCRIPTIONS[c]}
              </p>
            </button>
          ))}
        </div>
      ),
    },
    {
      id: "files",
      title: "上传文件",
      description: "拖入或选择文件",
      content: (
        <>
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
                  PDF、图片、文本/代码；单次最多 50 个文件，单个 ≤ 20MB
                </span>
              </>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-1 text-xs text-[var(--color-error)]">
              <WarningTriangle
                width={12}
                height={12}
                strokeWidth={2}
                className="mt-0.5 shrink-0"
              />
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
        </>
      ),
    },
  ];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
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
      <DialogContent
        className={cn(
          "max-w-[min(720px,calc(100vw-2rem))] sm:max-w-[720px]",
          className
        )}
      >
        <DialogHeader>
          <DialogTitle>上传资料</DialogTitle>
          <DialogDescription>
            先选资料分类，再上传文件。当前分类：
            <span className="font-medium text-[var(--color-text-primary)]">
              {category || "未选择"}
            </span>
            。支持 PDF、图片、文本/代码，单次最多 50 个。
          </DialogDescription>
        </DialogHeader>
        <Stepper
          steps={steps}
          currentStep={step}
          onStepChange={setStep}
          onComplete={() => inputRef.current?.click()}
          isCompleting={uploading}
          nextLabel={step === 0 ? "下一步：选择文件" : "选择文件"}
          completeLabel="选择文件"
        />
      </DialogContent>
    </Dialog>
  );
}
