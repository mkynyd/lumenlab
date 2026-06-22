"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { Stepper } from "@/components/ui/stepper";
import { FolderOpen, Sparkles } from "lucide-react";
import { useCreateProject } from "@/lib/hooks/use-projects";

const DRAFT_KEY = "new-project-draft";

interface ProjectDraft {
  name: string;
  description: string;
  type: string;
  quickActionDescription: string;
  customQuickActions: Array<{ title: string; prompt: string }>;
}

interface ClassificationData {
  roleKey: string | null;
  mode: string;
  domain: string;
  confidence: number;
  reason: string;
}

interface QuickActionItem {
  title: string;
  prompt: string;
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
    // silent
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
  { value: "general" as const, label: "通用项目", desc: "通用问答、创作辅助和知识管理" },
];

function initialDraft(): ProjectDraft {
  const saved = loadDraft();
  return saved ?? { name: "", description: "", type: "general", quickActionDescription: "", customQuickActions: [] };
}

export default function NewProjectPage() {
  const router = useRouter();
  const [draft, setDraft] = useState<ProjectDraft>(initialDraft);
  const [error, setError] = useState<string | null>(null);
  const createProject = useCreateProject();

  // Stepper state
  const [showStepper, setShowStepper] = useState(false);
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null);
  const [stepperStep, setStepperStep] = useState(0);
  const [roleInput, setRoleInput] = useState("");
  const [isClassifying, setIsClassifying] = useState(false);
  const [classification, setClassification] = useState<ClassificationData | null>(null);
  const [recommendedActions, setRecommendedActions] = useState<QuickActionItem[]>([]);
  const [selectedActions, setSelectedActions] = useState<Set<number>>(new Set());
  const [classifyError, setClassifyError] = useState<string | null>(null);

  useEffect(() => { saveDraft(draft); }, [draft]);

  useEffect(() => {
    function beforeUnload(event: BeforeUnloadEvent) {
      if (draft.name.trim() || draft.description.trim() || draft.customQuickActions.length > 0) {
        event.preventDefault();
      }
    }
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [draft]);

  function setName(value: string) { setDraft((prev) => ({ ...prev, name: value })); }
  function setDescription(value: string) { setDraft((prev) => ({ ...prev, description: value })); }
  function setType(value: string) { setDraft((prev) => ({ ...prev, type: value })); }
  function setQuickActionDescription(value: string) { setDraft((prev) => ({ ...prev, quickActionDescription: value })); }
  function setCustomQuickActions(value: Array<{ title: string; prompt: string }>) { setDraft((prev) => ({ ...prev, customQuickActions: value })); }

  // Create project, then show stepper
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
      setCreatedProjectId(data.project.id);
      setStepperStep(0);
      setShowStepper(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建项目失败，请重试");
    }
  }

  // Classify user role
  const runClassification = useCallback(async () => {
    if (!roleInput.trim()) return;
    setIsClassifying(true);
    setClassifyError(null);
    setStepperStep(1); // analyzing

    try {
      const res = await fetch("/api/classification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userInput: roleInput.trim(), mode: draft.type }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "分类失败");
      }

      const data = await res.json();
      setClassification(data.classification);
      setRecommendedActions(data.quickActions || []);
      setStepperStep(2); // show recommendations
    } catch (err) {
      setClassifyError(err instanceof Error ? err.message : "分类失败");
      setStepperStep(2); // show empty recommendations
    } finally {
      setIsClassifying(false);
    }
  }, [roleInput, draft.type]);

  // Save ProjectRole and QuickActions
  const savePersonalization = useCallback(async () => {
    if (!createdProjectId || !classification) {
      navigateToProject();
      return;
    }

    try {
      await fetch(`/api/projects/${createdProjectId}/personalization`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classification,
          quickActions: Array.from(selectedActions).map((i) => recommendedActions[i]),
        }),
      });
    } catch {
      // Non-blocking: personalization save failure shouldn't block navigation
    }
    navigateToProject();
  }, [createdProjectId, classification, selectedActions, recommendedActions]);

  function navigateToProject() {
    if (createdProjectId) {
      router.push(`/projects/${createdProjectId}`);
    } else {
      router.push("/chat");
    }
  }

  function skipStepper() {
    navigateToProject();
  }

  function toggleAction(index: number) {
    setSelectedActions((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function addCustomQuickAction() {
    const prompt = draft.quickActionDescription.trim();
    if (!prompt) return;
    setCustomQuickActions([
      ...draft.customQuickActions,
      { title: prompt.replace(/\s+/g, "").slice(0, 6) || "快捷操作", prompt },
    ]);
    setQuickActionDescription("");
  }

  // Stepper steps definition
  const stepperSteps = [
    {
      id: "identity",
      title: "身份",
      description: "告诉我们你的身份",
      content: (
        <div className="py-4">
          <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">
            请输入你的专业/职业
          </label>
          <p className="text-xs text-[var(--color-text-secondary)] mb-3">
            此信息仅用于智能匹配最适合你的工作模式和快捷任务，可随时跳过
          </p>
          <Input
            value={roleInput}
            onChange={(e) => setRoleInput(e.target.value)}
            placeholder="例如：信息安全专业本科生 / 高中化学教师 / 临床医学大三"
            maxLength={200}
            onKeyDown={(e) => {
              if (e.key === "Enter" && roleInput.trim()) {
                e.preventDefault();
                runClassification();
              }
            }}
          />
        </div>
      ),
      isValid: roleInput.trim().length >= 2,
    },
    {
      id: "analyzing",
      title: "分析",
      description: "正在分析",
      content: (
        <div className="flex flex-col items-center justify-center py-12">
          <p className="text-sm text-[var(--color-text-secondary)]">
            {isClassifying ? "正在分析你的项目需求..." : "分析完成"}
          </p>
        </div>
      ),
    },
    {
      id: "quick-actions",
      title: "快捷任务",
      description: "选择快捷任务",
      content: (
        <div className="py-4">
          {classifyError ? (
            <div className="text-center py-6">
              <p className="text-sm text-[var(--color-error)] mb-2">{classifyError}</p>
              <p className="text-xs text-[var(--color-text-secondary)]">你可以继续或跳过此步骤</p>
            </div>
          ) : (
            <>
              {classification && (
                <div className="mb-5 rounded-[var(--radius-md)] bg-[var(--color-accent-muted)] p-3">
                  <p className="text-sm font-medium text-[var(--color-accent)]">
                    {classification.domain || "通用"} · {classification.mode === "experiment" ? "实验" : classification.mode === "review" ? "复习" : classification.mode === "coding" ? "编程" : "通用"}模式
                  </p>
                  {classification.confidence < 0.7 && (
                    <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
                      分类置信度较低，你可以调整或跳过
                    </p>
                  )}
                </div>
              )}
              {recommendedActions.length > 0 ? (
                <div>
                  <p className="text-sm font-medium text-[var(--color-text-primary)] mb-2">
                    推荐快捷任务（点击选择）
                  </p>
                  <div className="space-y-2">
                    {recommendedActions.map((action, index) => (
                      <button
                        key={index}
                        type="button"
                        onClick={() => toggleAction(index)}
                        className={cn(
                          "w-full text-left rounded-[var(--radius-md)] p-3 transition-colors duration-150",
                          selectedActions.has(index)
                            ? "bg-[var(--color-accent-muted)] ring-1 ring-[var(--color-accent)]"
                            : "bg-[var(--color-project-control)] hover:bg-[var(--color-project-surface-hover)]"
                        )}
                      >
                        <p className="text-sm font-medium text-[var(--color-text-primary)]">{action.title}</p>
                        <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">{action.prompt}</p>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-[var(--color-text-secondary)] text-center py-6">
                  暂无推荐快捷任务，你可以跳过此步骤
                </p>
              )}
            </>
          )}
        </div>
      ),
    },
    {
      id: "complete",
      title: "完成",
      description: "一切就绪",
      content: (
        <div className="py-6 text-center">
          <div className="flex items-center justify-center w-14 h-14 mx-auto mb-4 rounded-full bg-[var(--color-accent-muted)]">
            <Sparkles size={24} strokeWidth={1.5} className="text-[var(--color-accent)]" />
          </div>
          <p className="text-sm font-medium text-[var(--color-text-primary)]">
            个性化设置完成
          </p>
          {classification && (
            <p className="text-xs text-[var(--color-text-secondary)] mt-2">
              {classification.domain} · 已为你匹配最佳工作模式
            </p>
          )}
          <p className="text-xs text-[var(--color-text-tertiary)] mt-3">
            你随时可以在项目设置中调整这些配置
          </p>
        </div>
      ),
    },
  ];

  // Main page content
  if (!showStepper) {
    return (
      <div className="project-workbench h-full overflow-y-auto">
        <div className="mx-auto max-w-2xl px-4 py-8 sm:px-8 md:py-14">
          {/* Header */}
          <div className="mb-10">
            <div className="flex items-center gap-4 mb-5">
              <div className="flex items-center justify-center w-12 h-12 rounded-[var(--radius-md)] bg-[var(--color-accent)]">
                <FolderOpen size={24} strokeWidth={1.75} className="text-[var(--color-accent-contrast)]" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text-primary)]">
                  新建项目
                </h1>
                <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                  创建一个新的学习/实验项目空间
                </p>
              </div>
            </div>
            <div className="h-px bg-[var(--color-accent-muted)]" />
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-7">
            <div>
              <label htmlFor="project-name" className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
                项目名称
              </label>
              <Input id="project-name" required maxLength={120} value={draft.name} onChange={(e) => setName(e.target.value)} placeholder="例如：密码学复习" />
            </div>

            <div>
              <label htmlFor="project-description" className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
                项目描述（选填）
              </label>
              <Textarea id="project-description" maxLength={1000} value={draft.description} onChange={(e) => setDescription(e.target.value)} className="h-24 resize-none" placeholder="简要描述这个项目的目标或内容" />
            </div>

            <div>
              <span id="project-type-label" className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">
                项目类型
              </span>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" role="radiogroup" aria-labelledby="project-type-label">
                {PROJECT_TYPES.map((pt) => (
                  <button
                    key={pt.value} type="button" role="radio" aria-checked={draft.type === pt.value}
                    onClick={() => setType(pt.value)}
                    className={cn(
                      "min-h-12 text-left p-3.5 rounded-[var(--radius-md)] transition-colors duration-150 focus-visible:bg-[var(--color-project-surface-hover)]",
                      draft.type === pt.value ? "bg-[var(--color-accent-muted)]" : "bg-[var(--color-project-control)] hover:bg-[var(--color-project-surface-hover)]"
                    )}
                  >
                    <span className={cn("text-sm", draft.type === pt.value ? "font-semibold text-[var(--color-accent)]" : "font-medium text-[var(--color-text-primary)]")}>
                      {pt.label}
                    </span>
                    <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5 leading-relaxed">{pt.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="quick-action-description" className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
                自定义快捷操作（选填）
              </label>
              <div className="flex gap-2">
                <Input id="quick-action-description" maxLength={500} value={draft.quickActionDescription} onChange={(e) => setQuickActionDescription(e.target.value)} placeholder="例如：把选中课件整理成考前速记表" />
                <Button type="button" variant="secondary" className="bg-[var(--color-project-control)] text-[var(--color-text-secondary)] hover:bg-[var(--color-project-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:bg-[var(--color-project-surface-hover)]" onClick={addCustomQuickAction}>
                  添加操作
                </Button>
              </div>
              {draft.customQuickActions.length > 0 && (
                <div className="mt-2 space-y-2">
                  {draft.customQuickActions.map((action, index) => (
                    <div key={`${action.title}-${index}`} className="grid gap-2 rounded-[var(--radius-md)] bg-[var(--color-project-control)] px-3 py-2 text-sm">
                      <div className="flex items-center gap-2">
                        <input value={action.title} onChange={(event) => setCustomQuickActions(draft.customQuickActions.map((item, i) => i === index ? { ...item, title: event.target.value.slice(0, 6) } : item))} className="h-7 w-20 rounded bg-[var(--color-bg)] px-2" aria-label="快捷操作标题" />
                        <button type="button" onClick={() => setCustomQuickActions(draft.customQuickActions.filter((_, i) => i !== index))} className="ml-auto text-[var(--color-text-tertiary)] hover:text-[var(--color-error)]" aria-label={`删除快捷操作 ${action.title}`}>删除</button>
                      </div>
                      <textarea value={action.prompt} onChange={(event) => setCustomQuickActions(draft.customQuickActions.map((item, i) => i === index ? { ...item, prompt: event.target.value } : item))} className="h-16 resize-none rounded bg-[var(--color-bg)] px-2 py-1" aria-label="快捷操作提示词" />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {error && <p className="text-sm text-[var(--color-error)]" role="alert">{error}</p>}

            <div className="flex items-center gap-3 pt-2">
              <Button type="submit" variant="primary" size="lg" className="bg-[var(--color-project-action)] text-[var(--color-project-action-contrast)] hover:bg-[var(--color-project-action-hover)] focus-visible:bg-[var(--color-project-action-hover)]" disabled={createProject.isPending}>
                {createProject.isPending && <Spinner data-icon="inline-start" />}
                创建项目
              </Button>
              <Button type="button" variant="secondary" size="lg" className="text-[var(--color-text-secondary)] hover:bg-[var(--color-project-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:bg-[var(--color-project-surface-hover)]" onClick={() => { clearDraft(); router.back(); }}>
                取消创建
              </Button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // Stepper overlay (post-creation)
  return (
    <div className="project-workbench h-full overflow-y-auto">
      <div className="mx-auto max-w-xl px-4 py-8 sm:px-8 md:py-14">
        <div className="mb-8">
          <h2 className="text-xl font-bold tracking-tight text-[var(--color-text-primary)]">
            个性化你的项目
          </h2>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            帮助我们了解你的使用场景，为你匹配最佳工作模式
          </p>
        </div>

        <Stepper
          steps={stepperSteps}
          currentStep={stepperStep}
          onStepChange={setStepperStep}
          onComplete={() => {
            if (stepperStep === 2) {
              // At quick action step → save personalization
              savePersonalization();
            } else if (stepperStep === 0) {
              // At identity step → run classification
              runClassification();
            }
          }}
          onSkip={skipStepper}
          isCompleting={isClassifying}
          completingText="正在分析你的项目需求..."
          skipLabel="跳过个性化设置"
          nextLabel={stepperStep === 0 ? "开始分析" : "下一步"}
          completeLabel={stepperStep === 2 ? "保存并进入项目" : "进入项目"}
        />
      </div>
    </div>
  );
}
