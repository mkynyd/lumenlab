"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { FolderOpen } from "lucide-react";
import { useCreateProject } from "@/lib/hooks/use-projects";

const DRAFT_KEY = "new-project-draft";

interface ProjectDraft {
  name: string;
  description: string;
  type: string;
  quickActionDescription: string;
  customQuickActions: Array<{ title: string; prompt: string }>;
}

function loadDraft(): ProjectDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ProjectDraft;
  } catch {
    return null;
  }
}

function saveDraft(draft: ProjectDraft) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // localStorage full or unavailable — silently skip
  }
}

function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    // ignore
  }
}

const PROJECT_TYPES = [
  { value: "experiment" as const, label: "实验工作台", desc: "处理实验数据、生成报告、绘图和计算" },
  { value: "review" as const, label: "资料复习", desc: "课件总结、考点分析、速记和思维导图" },
  { value: "coding" as const, label: "代码项目", desc: "解释代码、查找错误、生成 README" },
  { value: "general" as const, label: "通用项目", desc: "通用问答和学习辅助" },
];

function initialDraft(): ProjectDraft {
  const saved = loadDraft();
  return saved ?? { name: "", description: "", type: "experiment", quickActionDescription: "", customQuickActions: [] };
}

export default function NewProjectPage() {
  const router = useRouter();
  const [draft, setDraft] = useState<ProjectDraft>(initialDraft);
  const [error, setError] = useState<string | null>(null);
  const createProject = useCreateProject();

  // Persist draft to localStorage on every change
  useEffect(() => {
    saveDraft(draft);
  }, [draft]);

  // Warn before leaving with unsaved content
  useEffect(() => {
    function beforeUnload(event: BeforeUnloadEvent) {
      if (draft.name.trim() || draft.description.trim() || draft.customQuickActions.length > 0) {
        event.preventDefault();
      }
    }
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [draft]);

  // Helpers for ergonomic state updates
  function setName(value: string) { setDraft((prev) => ({ ...prev, name: value })); }
  function setDescription(value: string) { setDraft((prev) => ({ ...prev, description: value })); }
  function setType(value: string) { setDraft((prev) => ({ ...prev, type: value })); }
  function setQuickActionDescription(value: string) { setDraft((prev) => ({ ...prev, quickActionDescription: value })); }
  function setCustomQuickActions(value: Array<{ title: string; prompt: string }>) { setDraft((prev) => ({ ...prev, customQuickActions: value })); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.name.trim()) {
      setError("请输入项目名称");
      return;
    }

    setError(null);

    try {
      const data = await createProject.mutateAsync({
        name: draft.name.trim(),
        description: draft.description.trim() || undefined,
        type: draft.type as "experiment" | "review" | "coding" | "general",
        quickActions: draft.customQuickActions,
      });
      clearDraft();
      router.push(`/projects/${data.project.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建项目失败，请重试");
    }
  }

  function addCustomQuickAction() {
    const prompt = draft.quickActionDescription.trim();
    if (!prompt) return;
    setCustomQuickActions([
      ...draft.customQuickActions,
      {
        title: prompt.replace(/\s+/g, "").slice(0, 6) || "快捷操作",
        prompt,
      },
    ]);
    setQuickActionDescription("");
  }

  return (
    <div className="project-workbench h-full overflow-y-auto">
      <div className="max-w-lg mx-auto px-4 py-8">
        {/* 页头 */}
        <div className="flex items-center gap-3 mb-8">
          <div className="flex items-center justify-center w-10 h-10 rounded-[var(--radius-md)] bg-[var(--color-project-control)]">
            <FolderOpen size={20} strokeWidth={1.5} className="text-[var(--color-text-tertiary)]" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">
              新建项目
            </h1>
            <p className="text-sm text-[var(--color-text-secondary)]">
              创建一个新的学习/实验项目空间
            </p>
          </div>
        </div>

        {/* 表单 */}
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* 项目名称 */}
          <div>
            <label htmlFor="project-name" className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
              项目名称
            </label>
            <Input
              id="project-name"
              required
              maxLength={120}
              value={draft.name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：密码学复习"
            />
          </div>

          {/* 项目描述 */}
          <div>
            <label htmlFor="project-description" className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
              项目描述（选填）
            </label>
            <Textarea
              id="project-description"
              maxLength={1000}
              value={draft.description}
              onChange={(e) => setDescription(e.target.value)}
              className="h-20 resize-none bg-[var(--color-bg)]"
              placeholder="简要描述这个项目的目标或内容"
            />
          </div>

          {/* 项目类型 */}
          <div>
            <span id="project-type-label" className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">
              项目类型
            </span>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-labelledby="project-type-label">
              {PROJECT_TYPES.map((pt) => (
                <button
                  key={pt.value}
                  type="button"
                  role="radio"
                  aria-checked={draft.type === pt.value}
                  onClick={() => setType(pt.value)}
                  className={cn(
                    "min-h-11 text-left p-3 rounded-[var(--radius-md)] transition-colors duration-150 focus-visible:bg-[var(--color-project-surface-hover)]",
                    draft.type === pt.value
                      ? "bg-[var(--color-project-surface-active)]"
                      : "bg-[var(--color-project-control)] hover:bg-[var(--color-project-surface-hover)]"
                  )}
                >
                  <span
                    className={cn(
                      "text-xs text-[var(--color-text-primary)]",
                      draft.type === pt.value ? "font-semibold" : "font-medium"
                    )}
                  >
                    {pt.label}
                  </span>
                  <p className="text-[10px] text-[var(--color-text-tertiary)] mt-0.5 leading-relaxed">
                    {pt.desc}
                  </p>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="quick-action-description" className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
              自定义快捷操作（选填）
            </label>
            <div className="flex gap-2">
              <Input
                id="quick-action-description"
                maxLength={500}
                value={draft.quickActionDescription}
                onChange={(e) => setQuickActionDescription(e.target.value)}
                placeholder="例如：把选中课件整理成考前速记表"
              />
              <Button
                type="button"
                variant="secondary"
                className="bg-[var(--color-project-control)] text-[var(--color-text-secondary)] hover:bg-[var(--color-project-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:bg-[var(--color-project-surface-hover)]"
                onClick={addCustomQuickAction}
              >
                添加操作
              </Button>
            </div>
            {draft.customQuickActions.length > 0 && (
              <div className="mt-2 space-y-1">
                {draft.customQuickActions.map((action, index) => (
                  <div
                    key={`${action.title}-${index}`}
                    className="grid gap-1 rounded-[var(--radius-md)] bg-[var(--color-project-control)] px-2 py-1.5 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <input
                        value={action.title}
                        onChange={(event) =>
                          setCustomQuickActions(
                            draft.customQuickActions.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, title: event.target.value.slice(0, 6) }
                                : item
                            )
                          )
                        }
                        className="h-7 w-20 rounded bg-[var(--color-bg)] px-2"
                        aria-label="快捷操作标题"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setCustomQuickActions(
                            draft.customQuickActions.filter((_, itemIndex) => itemIndex !== index)
                          )
                        }
                        className="ml-auto text-[var(--color-text-tertiary)] hover:text-[var(--color-error)]"
                        aria-label={`删除快捷操作 ${action.title}`}
                      >
                        删除
                      </button>
                    </div>
                    <textarea
                      value={action.prompt}
                      onChange={(event) =>
                        setCustomQuickActions(
                          draft.customQuickActions.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, prompt: event.target.value }
                              : item
                          )
                        )
                      }
                      className="h-16 resize-none rounded bg-[var(--color-bg)] px-2 py-1"
                      aria-label="快捷操作提示词"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {error && (
            <p className="text-sm text-[var(--color-error)]" role="alert">
              {error}
            </p>
          )}

          <div className="flex items-center gap-3 pt-2">
            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="bg-[var(--color-project-action)] text-[var(--color-project-action-contrast)] hover:bg-[var(--color-project-action-hover)] focus-visible:bg-[var(--color-project-action-hover)]"
              disabled={createProject.isPending}
            >
              {createProject.isPending && <Spinner data-icon="inline-start" />}
              创建项目
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="lg"
              className="text-[var(--color-text-secondary)] hover:bg-[var(--color-project-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:bg-[var(--color-project-surface-hover)]"
              onClick={() => { clearDraft(); router.back(); }}
            >
              取消创建
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
