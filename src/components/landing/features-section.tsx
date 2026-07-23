"use client";

import { FolderOpen, MessageSquareText, FileType2 } from "lucide-react";
import { SectionReveal } from "./section-reveal";
import { ChatDemo } from "./demos/chat-demo";
import { ProjectDemo } from "./demos/project-demo";
import { ConversionDemo } from "./demos/conversion-demo";
import { cn } from "@/lib/utils";

interface FeatureItem {
  id: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  demo: React.ReactNode;
}

const FEATURES: FeatureItem[] = [
  {
    id: "project",
    icon: <FolderOpen size={22} strokeWidth={1.75} />,
    title: "按项目整理资料",
    description:
      "讲义、实验数据、代码和复习材料按项目分组，不再散落在聊天记录里。每个项目都有独立的资料库、对话历史和成果库。",
    demo: <ProjectDemo className="h-[420px] md:h-[520px]" />,
  },
  {
    id: "chat",
    icon: <MessageSquareText size={22} strokeWidth={1.75} />,
    title: "基于资料上下文回答",
    description:
      "上传文件后，问答直接引用项目资料。支持深度推理、附件上传和快捷任务，让 AI 的回答有依据、可验证。",
    demo: <ChatDemo className="h-[420px] md:h-[520px]" />,
  },
  {
    id: "convert",
    icon: <FileType2 size={22} strokeWidth={1.75} />,
    title: "PDF 转结构化 Markdown",
    description:
      "把 PDF 课件解析为保留图片、公式和代码块的 Markdown，再导出为 MD、PDF 或 DOCX，直接用于复习和报告。",
    demo: <ConversionDemo className="h-[420px] md:h-[520px]" />,
  },
];

export function FeaturesSection() {
  return (
    <div id="features" className="relative">
      {FEATURES.map((feature, index) => (
        <SectionReveal
          key={feature.id}
          className="mx-auto flex min-h-screen w-full max-w-7xl items-center px-4 py-20 sm:px-6 md:py-28"
          innerClassName="w-full"
          yOffset={40 + index * 8}
        >
          <article className="grid min-w-0 items-center gap-10 md:grid-cols-2 md:gap-16 lg:gap-24">
            <div
              className={cn(
                "min-w-0 flex flex-col gap-6",
                index % 2 === 1 ? "md:order-2" : "md:order-1"
              )}
            >
              <div className="flex size-11 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-accent-muted)] text-[var(--color-accent)]">
                {feature.icon}
              </div>

              <h3 className="text-[clamp(1.625rem,3.4vw,2.5rem)] font-semibold leading-[1.12] tracking-[-0.025em] text-[var(--color-text-primary)]">
                {feature.title}
              </h3>

              <p
                className="max-w-[46ch] text-[16px] leading-[1.65] text-[var(--color-text-secondary)]"
                style={{ textWrap: "pretty" }}
              >
                {feature.description}
              </p>
            </div>

            <div
              className={cn(
                "min-h-0 min-w-0",
                index % 2 === 1 ? "md:order-1" : "md:order-2"
              )}
            >
              {feature.demo}
            </div>
          </article>
        </SectionReveal>
      ))}
    </div>
  );
}
