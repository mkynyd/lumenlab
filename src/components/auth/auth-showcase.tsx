"use client";

import { useState, type ComponentType } from "react";
import {
  ArrowLeft,
  ArrowRight,
  FileOutput,
  FolderOpen,
  Route,
} from "lucide-react";
import { AmbientField } from "@/components/workbench/ambient-field";
import { cn } from "@/lib/utils";

interface ShowcaseSlide {
  title: string;
  description: string;
  stages: [string, string, string];
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}

const SHOWCASE_SLIDES: ShowcaseSlide[] = [
  {
    title: "从资料出发，得到真正有上下文的回答",
    description:
      "上传课程讲义、论文与文档，按文件选择上下文，让每次提问都围绕你的材料展开。",
    stages: ["上传资料", "选择范围", "继续追问"],
    icon: FolderOpen,
  },
  {
    title: "把学习目标变成一条可执行的路径",
    description:
      "确认目标和范围，生成知识地图，接着完成诊断、练习与到期复习。",
    stages: ["设定目标", "建立地图", "练习复习"],
    icon: Route,
  },
  {
    title: "让有价值的结果随时沉淀与导出",
    description:
      "保存回答为成果，并将 Markdown、DOCX 与 PDF 带出工作台继续使用。",
    stages: ["保存成果", "继续整理", "多格式导出"],
    icon: FileOutput,
  },
];

export function AuthShowcase() {
  const [activeIndex, setActiveIndex] = useState(0);
  const slide = SHOWCASE_SLIDES[activeIndex];
  const Icon = slide.icon;

  function showPrevious() {
    setActiveIndex((index) =>
      index === 0 ? SHOWCASE_SLIDES.length - 1 : index - 1
    );
  }

  function showNext() {
    setActiveIndex((index) => (index + 1) % SHOWCASE_SLIDES.length);
  }

  return (
    <aside
      aria-label="LumenLab 产品介绍"
      aria-roledescription="轮播"
      className="auth-showcase-surface relative isolate hidden min-h-0 overflow-hidden rounded-[var(--radius-xl)] lg:sticky lg:top-4 lg:flex lg:h-[calc(100dvh-2rem)] lg:self-start lg:flex-col"
    >
      <AmbientField intensity="medium" density="wide" className="-z-10" />

      <div className="flex flex-1 flex-col justify-center px-10 py-14 xl:px-16 2xl:px-20">
        <div
          key={activeIndex}
          aria-live="polite"
          aria-atomic="true"
          className="motion-safe:animate-slide-up-fade max-w-2xl"
        >
          <span className="mb-8 flex size-12 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--color-accent)] text-[var(--color-accent-contrast)]">
            <Icon aria-hidden className="size-6" />
          </span>
          <h2 className="max-w-[18ch] text-balance text-3xl font-semibold leading-[1.18] tracking-[-0.025em] text-[var(--color-text-primary)] xl:text-[2.5rem]">
            {slide.title}
          </h2>
          <p className="mt-5 max-w-[36rem] text-base leading-7 text-[var(--color-text-secondary)] xl:text-lg xl:leading-8">
            {slide.description}
          </p>

          <ol className="mt-10 grid grid-cols-3 gap-1 rounded-[var(--radius-lg)] bg-[var(--color-interaction-hover)] p-1.5">
            {slide.stages.map((stage, index) => (
              <li
                key={stage}
                className="flex min-w-0 items-center gap-2 rounded-[var(--radius-md)] px-3 py-3 text-sm font-medium text-[var(--color-text-secondary)]"
              >
                <span
                  aria-hidden
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    index === 1
                      ? "bg-[var(--color-accent)]"
                      : "bg-[var(--color-text-tertiary)]"
                  )}
                />
                <span className="truncate">{stage}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <div className="flex items-center justify-between px-10 pb-10 xl:px-16 xl:pb-14 2xl:px-20">
        <div className="flex items-center" aria-label="选择产品介绍">
          {SHOWCASE_SLIDES.map((item, index) => (
            <button
              key={item.title}
              type="button"
              aria-label={`显示第 ${index + 1} 项产品介绍`}
              aria-current={index === activeIndex ? "true" : undefined}
              onClick={() => setActiveIndex(index)}
              className="flex size-11 items-center justify-center rounded-full"
            >
              <span
                aria-hidden
                className={cn(
                  "h-1.5 rounded-full transition-[width,background-color] duration-200",
                  index === activeIndex
                    ? "w-7 bg-[var(--color-text-primary)]"
                    : "w-1.5 bg-[var(--color-text-tertiary)]"
                )}
              />
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={showPrevious}
            aria-label="上一项产品介绍"
            className="flex size-11 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-interaction-hover)] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-interaction-active)]"
          >
            <ArrowLeft aria-hidden className="size-5" />
          </button>
          <button
            type="button"
            onClick={showNext}
            aria-label="下一项产品介绍"
            className="flex size-11 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-text-primary)] text-[var(--color-bg)] transition-opacity hover:opacity-80"
          >
            <ArrowRight aria-hidden className="size-5" />
          </button>
        </div>
      </div>
    </aside>
  );
}
