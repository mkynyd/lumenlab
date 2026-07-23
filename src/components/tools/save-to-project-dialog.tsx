"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Folder } from "iconoir-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { fetchJson } from "@/lib/api/client";
import { useProjects } from "@/lib/hooks/use-projects";
import { queryKeys } from "@/lib/query-keys";

interface SaveToProjectDialogProps {
  conversionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (projectName: string) => void;
}

export function SaveToProjectDialog({
  conversionId,
  open,
  onOpenChange,
  onSaved,
}: SaveToProjectDialogProps) {
  const projectsQuery = useProjects();
  const queryClient = useQueryClient();
  const [savingProjectId, setSavingProjectId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const projects = projectsQuery.data || [];

  async function save(projectId: string, projectName: string) {
    setSavingProjectId(projectId);
    setError(null);
    try {
      await fetchJson<{ fileId: string; projectId: string }>(
        `/api/tools/conversions/${conversionId}/save-to-project`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId }),
        },
      );
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.projects.files(projectId),
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projects.all }),
      ]);
      onOpenChange(false);
      onSaved?.(projectName);
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "保存失败，请重试",
      );
    } finally {
      setSavingProjectId(null);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) setError(null);
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="max-w-[min(28rem,calc(100vw-2rem))] gap-3 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>保存到项目</DialogTitle>
          <DialogDescription>
            转换结果将以 Markdown 文件形式存入所选项目。
          </DialogDescription>
        </DialogHeader>

        {projectsQuery.isPending ? (
          <div
            className="flex min-h-32 items-center justify-center"
            role="status"
          >
            <Spinner />
            <span className="sr-only">正在加载项目</span>
          </div>
        ) : projects.length > 0 ? (
          <ScrollArea className="max-h-72">
            <div className="divide-y divide-[var(--color-border-light)] pr-3">
              {projects.map((project) => (
                <Button
                  key={project.id}
                  type="button"
                  variant="ghost"
                  size="lg"
                  className="h-auto min-h-11 w-full justify-start rounded-none px-2 py-2 text-left"
                  disabled={savingProjectId !== null}
                  onClick={() => void save(project.id, project.name)}
                >
                  {savingProjectId === project.id ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <Folder data-icon="inline-start" strokeWidth={1.7} />
                  )}
                  <span className="min-w-0 truncate">{project.name}</span>
                </Button>
              ))}
            </div>
          </ScrollArea>
        ) : (
          <p className="border-y border-[var(--color-border-light)] px-4 py-8 text-center text-sm text-[var(--color-text-tertiary)]">
            暂无项目，请先创建项目后再保存。
          </p>
        )}

        {error && (
          <p
            role="alert"
            className="border-t border-[var(--color-border-light)] pt-3 text-sm text-[var(--color-error)]"
          >
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
