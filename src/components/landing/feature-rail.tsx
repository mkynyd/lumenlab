"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ChatDemo } from "./demos/chat-demo";
import { ConversionDemo } from "./demos/conversion-demo";
import { ProjectDemo } from "./demos/project-demo";
import { FeatureBlock, type FeatureAlign } from "./feature-block";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

interface FeatureSpec {
  index: number;
  eyebrow: string;
  title: string;
  description: string;
  align: FeatureAlign;
  tripleHighlights?: Array<{ label: string; value: string }>;
}

const FEATURES: FeatureSpec[] = [
  {
    index: 1,
    eyebrow: "项目空间",
    title: "每个项目自带上下文。",
    description:
      "把课程实验、课题、复习单元放进独立项目。资料、对话、成果互不串台，引用的每一句话都能点回来源。",
    align: "right",
  },
  {
    index: 2,
    eyebrow: "AI 对话",
    title: "对话接得住你的资料。",
    description:
      "上传讲义、代码或扫描件后，问答直接读上下文。支持深度推理、附件、引用段落，回复可以一键转成可保存的成果。",
    align: "left",
  },
  {
    index: 3,
    eyebrow: "文档转换",
    title: "把 PDF 还原成可编辑的研究材料。",
    description:
      "PDF 转 Markdown，保留图片、公式与代码块。转换结果可以保存到项目，或者打包导出为 Markdown / PDF / DOCX。",
    align: "triple",
    tripleHighlights: [
      { label: "图片资源", value: "原样保留" },
      { label: "公式 / 代码", value: "KaTeX + 语法高亮" },
      { label: "导出", value: "MD / PDF / DOCX" },
    ],
  },
];

/**
 * 三个功能展示段。
 *  - 桌面 (>=768px) 用 GSAP ScrollTrigger pin 外层容器，内部 track 水平平移 200vw
 *  - 移动 (<768px) 退化为垂直堆叠（不订阅 ScrollTrigger）
 *  - prefers-reduced-motion: 全部退化为直接可见（不做任何 GSAP 设置）
 */
export function FeatureRail() {
  const sectionRef = useRef<HTMLElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const section = sectionRef.current;
    const track = trackRef.current;
    if (!section || !track) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reducedMotion.matches) return;

    const mm = gsap.matchMedia();

    mm.add("(min-width: 768px)", () => {
      const tween = gsap.to(track, {
        x: () => -(track.scrollWidth - window.innerWidth),
        ease: "none",
        scrollTrigger: {
          trigger: section,
          start: "top top",
          end: () => `+=${track.scrollWidth - window.innerWidth}`,
          pin: true,
          scrub: 0.6,
          invalidateOnRefresh: true,
          anticipatePin: 1,
        },
      });
      return () => tween.kill();
    });

    return () => {
      mm.revert();
    };
  }, []);

  return (
    <section
      id="features"
      ref={sectionRef}
      aria-label="核心功能"
      className="relative bg-[var(--color-bg)]"
    >
      <div className="mx-auto w-full max-w-7xl px-4 pt-20 pb-4 sm:px-6 md:pt-28">
        <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-tertiary)]">
          核心功能
        </p>
        <h2
          className="mt-3 max-w-[20ch] text-[clamp(1.875rem,3.6vw,2.75rem)] font-semibold leading-[1.12] tracking-[-0.025em] text-[var(--color-text-primary)]"
          style={{ textWrap: "balance" }}
        >
          三个让工作台更像工作台的能力。
        </h2>
        <p
          className="mt-4 max-w-[58ch] text-[15px] leading-relaxed text-[var(--color-text-secondary)]"
          style={{ textWrap: "pretty" }}
        >
          从管理一份实验资料，到和 AI 一起把它读透、再导出为可提交的成果——整条流程都在同一处。
        </p>
      </div>

      <div
        ref={trackRef}
        className="flex w-full flex-col md:h-screen md:w-[300vw] md:flex-row"
      >
        {FEATURES.map((feature) => (
          <div
            key={feature.index}
            className="w-full px-2 py-10 md:flex md:h-screen md:w-screen md:items-center md:px-10 md:py-0 lg:px-16"
          >
            <div className="mx-auto w-full max-w-6xl">
              <FeatureBlock
                index={feature.index}
                eyebrow={feature.eyebrow}
                title={feature.title}
                description={feature.description}
                align={feature.align}
                tripleHighlights={feature.tripleHighlights}
                demo={renderDemo(feature.index)}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function renderDemo(index: number) {
  switch (index) {
    case 1:
      return <ProjectDemo className="max-h-[640px]" />;
    case 2:
      return <ChatDemo className="max-h-[640px]" />;
    case 3:
      return <ConversionDemo className="max-h-[640px]" />;
    default:
      return null;
  }
}
