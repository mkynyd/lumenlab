"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FolderOpen } from "lucide-react";

const PROJECT_TYPES = [
  { value: "experiment" as const, label: "实验工作台", desc: "处理实验数据、生成报告、绘图和计算" },
  { value: "review" as const, label: "资料复习", desc: "课件总结、考点分析、速记和思维导图" },
  { value: "coding" as const, label: "代码项目", desc: "解释代码、查找错误、生成 README" },
  { value: "general" as const, label: "通用项目", desc: "通用问答和学习辅助" },
];

export default function NewProjectPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<string>("experiment");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("请输入项目名称");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          type,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(typeof data.error === "string" ? data.error : "创建失败");
      }

      const data = await res.json();
      router.push(`/projects/${data.project.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建项目失败，请重试");
      setIsLoading(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-lg mx-auto px-4 py-8">
        {/* 页头 */}
        <div className="flex items-center gap-3 mb-8">
          <div className="flex items-center justify-center w-10 h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
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
            <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
              项目名称
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：计算机网络实验、操作系统复习"
            />
          </div>

          {/* 项目描述 */}
          <div>
            <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
              项目描述（选填）
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={cn(
                "w-full h-20 px-3 py-2 text-sm rounded-[var(--radius-md)] resize-none",
                "border border-[var(--color-border)]",
                "bg-[var(--color-bg)] text-[var(--color-text-primary)]",
                "placeholder:text-[var(--color-text-tertiary)]",
                "focus:outline-none focus:border-[var(--color-accent)]",
                "transition-colors duration-150"
              )}
              placeholder="简要描述这个项目的目标或内容"
            />
          </div>

          {/* 项目类型 */}
          <div>
            <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">
              项目类型
            </label>
            <div className="grid grid-cols-2 gap-2">
              {PROJECT_TYPES.map((pt) => (
                <button
                  key={pt.value}
                  type="button"
                  onClick={() => setType(pt.value)}
                  className={cn(
                    "text-left p-3 rounded-[var(--radius-md)] border transition-colors duration-150",
                    type === pt.value
                      ? "border-[var(--color-accent)] bg-[var(--color-accent-muted)]"
                      : "border-[var(--color-border)] hover:border-[var(--color-text-tertiary)]"
                  )}
                >
                  <span
                    className={cn(
                      "text-xs font-medium",
                      type === pt.value
                        ? "text-[var(--color-accent)]"
                        : "text-[var(--color-text-primary)]"
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
              isLoading={isLoading}
            >
              创建项目
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="lg"
              onClick={() => router.back()}
            >
              取消
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
