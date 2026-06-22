"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Stepper } from "@/components/ui/stepper";
import { RotatingText } from "@/components/ui/rotating-text";
import { FolderOpen, Sparkles } from "lucide-react";
import { useCreateProject } from "@/lib/hooks/use-projects";

const PROJECT_TYPES = [
  { value: "general" as const, label: "通用项目", desc: "通用问答、创作辅助和知识管理" },
  { value: "review" as const, label: "资料复习", desc: "资料总结、考点分析、速记和思维导图" },
  { value: "experiment" as const, label: "实验工作台", desc: "处理实验数据、生成报告、绘图和计算" },
  { value: "coding" as const, label: "代码项目", desc: "解释代码、查找错误、生成文档" },
];

interface QuickActionItem {
  title: string;
  prompt: string;
}

export default function NewProjectPage() {
  const router = useRouter();
  const createProject = useCreateProject();

  // Stepper state
  const [step, setStep] = useState(0);
  const [projectName, setProjectName] = useState("");
  const [projectType, setProjectType] = useState("general");
  const [userInput, setUserInput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedPrompt, setGeneratedPrompt] = useState("");
  const [quickActions, setQuickActions] = useState<QuickActionItem[]>([]);
  const [selectedActions, setSelectedActions] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // Create project first, then trigger prompt generation
  const handleCreateAndGenerate = useCallback(async () => {
    if (!projectName.trim()) {
      setError("请输入项目名称");
      return;
    }
    setError(null);

    try {
      const data = await createProject.mutateAsync({
        name: projectName.trim(),
        type: projectType as "experiment" | "review" | "coding" | "general",
        quickActions: [],
      });

      // Move to analyzing step
      setStep(2);
      setIsGenerating(true);

      // Call generate-prompt API
      const res = await fetch(`/api/projects/${data.project.id}/generate-prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userInput: userInput.trim(), mode: projectType }),
      });

      if (!res.ok) {
        let msg = "生成失败";
        try { const err = await res.json(); msg = err.error || msg; } catch { /* ignore */ }
        throw new Error(msg);
      }

      const result = await res.json();
      setGeneratedPrompt(result.systemPrompt || "");
      setQuickActions(result.quickActions || []);
      setStep(3);

      // Store project ID for navigation
      (window as unknown as Record<string, unknown>)._newProjectId = data.project.id;
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
      setStep(2); // stay on analyzing step to show error
    } finally {
      setIsGenerating(false);
    }
  }, [projectName, projectType, userInput, createProject]);

  function goToProject() {
    const id = (window as unknown as Record<string, unknown>)._newProjectId as string;
    if (id) router.push(`/projects/${id}`);
    else router.push("/chat");
  }

  function toggleAction(index: number) {
    setSelectedActions((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  const steps = [
    {
      id: "basics",
      title: "基本信息",
      description: "项目名称与类型",
      isValid: projectName.trim().length > 0,
      content: (
        <div className="py-4 space-y-5">
          <div>
            <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
              项目名称
            </label>
            <Input
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="例如：密码学复习、生理学期末"
              maxLength={120}
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">
              项目类型
            </label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {PROJECT_TYPES.map((pt) => (
                <button
                  key={pt.value}
                  type="button"
                  onClick={() => setProjectType(pt.value)}
                  className={cn(
                    "min-h-12 text-left p-3 rounded-[var(--radius-md)] transition-colors duration-150",
                    projectType === pt.value
                      ? "bg-[var(--color-accent-muted)]"
                      : "bg-[var(--color-project-control)] hover:bg-[var(--color-project-surface-hover)]"
                  )}
                >
                  <span className={cn("text-sm", projectType === pt.value ? "font-semibold text-[var(--color-accent)]" : "font-medium text-[var(--color-text-primary)]")}>
                    {pt.label}
                  </span>
                  <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">{pt.desc}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "describe",
      title: "场景描述",
      description: "描述你的使用场景",
      isValid: userInput.trim().length >= 2,
      content: (
        <div className="py-4 space-y-3">
          <label className="block text-sm font-medium text-[var(--color-text-primary)]">
            描述你的使用场景
          </label>
          <p className="text-xs text-[var(--color-text-secondary)]">
            用自然语言告诉 AI 你的背景和目的，AI 会据此生成专属的项目提示词和快捷任务。
          </p>
          <Textarea
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            placeholder="例如：我是大二医学生，想整理生理学期末复习资料，需要重点背诵的考点和名词解释"
            maxLength={500}
            className="h-28 resize-none"
          />
          {error && <p className="text-sm text-[var(--color-error)]">{error}</p>}
        </div>
      ),
    },
    {
      id: "generating",
      title: "生成中",
      description: "AI 分析",
      content: (
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          {error ? (
            <>
              <p className="text-sm text-[var(--color-error)]">{error}</p>
              <Button variant="secondary" size="sm" onClick={() => setStep(1)}>
                返回修改
              </Button>
            </>
          ) : (
            <div className="flex flex-col items-center gap-5">
              <Sparkles size={28} strokeWidth={1.5} className="text-[var(--color-accent)] animate-pulse" />
              <RotatingText
                words={[
                  "思考", "探索", "生成", "个性化", "定制",
                  "烧烤", "进食", "品尝", "翻箱倒柜", "品鉴",
                  "构建", "深蹲", "卧推",
                ]}
                interval={2200}
                prefix="正在"
                suffix="..."
                className="text-sm text-[var(--color-text-secondary)] font-medium"
              />
              <p className="text-xs text-[var(--color-text-tertiary)]">
                正在分析你的场景，生成专属配置
              </p>
            </div>
          )}
        </div>
      ),
    },
    {
      id: "result",
      title: "确认",
      description: "查看结果",
      content: (
        <div className="py-4 space-y-4">
          {/* Generated prompt */}
          {generatedPrompt && (
            <div>
              <p className="text-sm font-medium text-[var(--color-text-primary)] mb-2">生成的提示词</p>
              <div className="rounded-[var(--radius-md)] bg-[var(--color-project-control)] p-3 max-h-60 overflow-y-auto">
                <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed whitespace-pre-wrap">
                  {generatedPrompt}
                </p>
              </div>
            </div>
          )}

          {/* Quick actions */}
          {quickActions.length > 0 && (
            <div>
              <p className="text-sm font-medium text-[var(--color-text-primary)] mb-2">
                推荐快捷任务（点击选择）
              </p>
              <div className="space-y-2">
                {quickActions.map((action, index) => (
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
          )}

          {!generatedPrompt && !error && (
            <p className="text-sm text-[var(--color-text-secondary)] text-center py-6">AI 未返回内容，你可以跳过此步骤</p>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="project-workbench h-full overflow-y-auto">
      <div className="mx-auto max-w-xl px-4 py-8 sm:px-8 md:py-14">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-4 mb-5">
            <div className="flex items-center justify-center w-10 h-10 rounded-[var(--radius-md)] bg-[var(--color-accent)]">
              <FolderOpen size={22} strokeWidth={1.75} className="text-[var(--color-accent-contrast)]" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-[var(--color-text-primary)]">新建项目</h1>
              <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">AI 会根据你的场景生成专属配置</p>
            </div>
          </div>
        </div>

        <Stepper
          steps={steps}
          currentStep={step}
          onStepChange={(next) => {
            if (step === 1 && next === 2) {
              handleCreateAndGenerate();
              return;
            }
            setStep(next);
          }}
          onComplete={goToProject}
          onSkip={goToProject}
          isCompleting={isGenerating}
          skipLabel="跳过"
          nextLabel={step === 1 ? "生成配置" : "下一步"}
          completeLabel="进入项目"
        />
      </div>
    </div>
  );
}
