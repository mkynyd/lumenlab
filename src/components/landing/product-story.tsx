"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { FileText, FolderOpen, MessageSquareText } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChatDemo } from "./demos/chat-demo";
import { ConversionDemo } from "./demos/conversion-demo";
import { ProjectDemo } from "./demos/project-demo";
import { usePrefersReducedMotion } from "./prefers-motion";

interface StoryChapter {
  id: string;
  index: string;
  label: string;
  title: string;
  description: string;
  detail: string;
  icon: ReactNode;
  demo: ReactNode;
}

const STORY_CHAPTERS: StoryChapter[] = [
  {
    id: "organize",
    index: "01",
    label: "项目空间",
    title: "资料先归位，问题才有上下文",
    description:
      "把讲义、实验数据、代码和作业放进同一个项目。之后的每次提问，都能沿用这套资料与项目目标。",
    detail: "一个项目，持续保存资料、对话与成果。",
    icon: <FolderOpen size={17} strokeWidth={1.8} />,
    demo: <ProjectDemo className="h-full" />,
  },
  {
    id: "ask",
    index: "02",
    label: "上下文对话",
    title: "回答引用你正在学的内容",
    description:
      "直接围绕项目资料追问。模型、推理强度、附件和联网能力都在同一个输入区，不打断思路。",
    detail: "从原始材料出发，保留推导与引用。",
    icon: <MessageSquareText size={17} strokeWidth={1.8} />,
    demo: <ChatDemo className="h-full" />,
  },
  {
    id: "deliver",
    index: "03",
    label: "结构化成果",
    title: "从 PDF 到可继续编辑的成果",
    description:
      "课件解析后保留标题、公式、图片和代码结构，再导出 Markdown、PDF 或 DOCX，直接进入复习与写作。",
    detail: "解析、检查、保存和导出形成一条闭环。",
    icon: <FileText size={17} strokeWidth={1.8} />,
    demo: <ConversionDemo className="h-full" />,
  },
];

/**
 * 产品叙事主段。
 *
 * 桌面端由 ScrollTrigger 固定一屏，并在三段真实产品预览间切换；
 * 移动端使用原生横向 snap，避免窄屏上的长距离 pin；
 * reduced-motion 模式保留全部章节，仅改为普通纵向阅读。
 */
export function ProductStory() {
  const rootRef = useRef<HTMLElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const progressRef = useRef<HTMLSpanElement | null>(null);
  const copyRefs = useRef<Array<HTMLDivElement | null>>([]);
  const panelRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (reducedMotion) return;

    let cancelled = false;
    let context: { revert: () => void } | undefined;
    let media:
      | {
          add: (
            query: string,
            setup: () => void | (() => void)
          ) => unknown;
          revert: () => void;
        }
      | undefined;

    async function setupStory() {
      const [{ gsap }, { ScrollTrigger }] = await Promise.all([
        import("gsap"),
        import("gsap/ScrollTrigger"),
      ]);

      if (cancelled || !rootRef.current || !frameRef.current) return;

      gsap.registerPlugin(ScrollTrigger);
      context = gsap.context(() => {
        media = gsap.matchMedia();
        media.add(
          "(min-width: 1024px) and (prefers-reduced-motion: no-preference)",
          () => {
            const copies = copyRefs.current.filter(
              (node): node is HTMLDivElement => Boolean(node)
            );
            const panels = panelRefs.current.filter(
              (node): node is HTMLDivElement => Boolean(node)
            );
            const progress = progressRef.current;

            if (
              copies.length !== STORY_CHAPTERS.length ||
              panels.length !== STORY_CHAPTERS.length ||
              !progress
            ) {
              return;
            }

            gsap.set([...copies, ...panels], {
              autoAlpha: 0,
              y: 10,
            });
            gsap.set([copies[0], panels[0]], {
              autoAlpha: 1,
              y: 0,
            });
            gsap.set(progress, {
              scaleY: 0.04,
              transformOrigin: "top center",
            });

            const storyDuration = STORY_CHAPTERS.length - 1 + 0.24;
            let lastIndex = 0;
            const timeline = gsap.timeline({
              defaults: { overwrite: "auto" },
              scrollTrigger: {
                id: "lumenlab-product-story",
                trigger: rootRef.current,
                start: "top top+=52",
                end: () =>
                  `+=${Math.max(window.innerHeight * 2.2, 1480)}`,
                pin: frameRef.current,
                pinSpacing: true,
                scrub: 0.2,
                anticipatePin: 1,
                invalidateOnRefresh: true,
                onUpdate: (self) => {
                  const nextIndex = Math.min(
                    STORY_CHAPTERS.length - 1,
                    Math.max(
                      0,
                      Math.floor(self.progress * storyDuration)
                    )
                  );
                  if (nextIndex !== lastIndex) {
                    lastIndex = nextIndex;
                    setActiveIndex(nextIndex);
                  }
                },
              },
            });

            timeline.to(
              progress,
              {
                scaleY: 1,
                duration: storyDuration,
                ease: "none",
              },
              0
            );

            for (let index = 1; index < STORY_CHAPTERS.length; index += 1) {
              timeline
                .to(
                  [copies[index - 1], panels[index - 1]],
                  {
                    autoAlpha: 0,
                    y: -8,
                    duration: 0.18,
                    ease: "power2.in",
                  },
                  index - 0.18
                )
                .fromTo(
                  [copies[index], panels[index]],
                  {
                    autoAlpha: 0,
                    y: 10,
                  },
                  {
                    autoAlpha: 1,
                    y: 0,
                    duration: 0.22,
                    ease: "power2.out",
                  },
                  index
                );
            }

            return () => {
              lastIndex = 0;
            };
          }
        );
      }, rootRef);
    }

    void setupStory();

    return () => {
      cancelled = true;
      media?.revert();
      context?.revert();
    };
  }, [reducedMotion]);

  return (
    <section
      ref={rootRef}
      id="features"
      aria-label="LumenLab 产品工作流"
      className="relative scroll-mt-14"
    >
      <MobileStory reducedMotion={reducedMotion} />

      {reducedMotion ? (
        <ReducedMotionStory />
      ) : (
        <div ref={frameRef} className="hidden min-h-[calc(100svh-3.25rem)] lg:block">
          <div className="mx-auto flex min-h-[calc(100svh-3.25rem)] w-full max-w-7xl flex-col px-6 py-10 xl:px-8 xl:py-12">
            <StoryHeading id="product-story-title-desktop" />

            <div className="grid min-h-0 flex-1 grid-cols-[minmax(260px,0.72fr)_minmax(0,1.65fr)] items-center gap-12 xl:gap-20">
              <div className="grid grid-cols-[28px_minmax(0,1fr)] gap-6">
                <StoryRail activeIndex={activeIndex} progressRef={progressRef} />

                <div className="relative min-h-64">
                  {STORY_CHAPTERS.map((chapter, index) => (
                    <div
                      key={chapter.id}
                      ref={(node) => {
                        copyRefs.current[index] = node;
                      }}
                      aria-hidden={activeIndex !== index}
                      className={cn(
                        "absolute inset-0 flex flex-col justify-center",
                        index === 0
                          ? "visible translate-y-0 opacity-100"
                          : "invisible translate-y-2.5 opacity-0",
                        activeIndex !== index && "pointer-events-none"
                      )}
                    >
                      <StoryCopy chapter={chapter} />
                    </div>
                  ))}
                </div>
              </div>

              <div className="relative h-[min(64vh,620px)] min-h-[480px]">
                {STORY_CHAPTERS.map((chapter, index) => (
                  <div
                    key={chapter.id}
                    ref={(node) => {
                      panelRefs.current[index] = node;
                    }}
                    aria-hidden={activeIndex !== index}
                    inert={activeIndex !== index}
                    data-story-panel={chapter.id}
                    className={cn(
                      "absolute inset-0 overflow-hidden rounded-[28px] bg-[var(--color-surface)] ring-1 ring-[var(--color-border-light)]",
                      index === 0
                        ? "visible translate-y-0 opacity-100"
                        : "invisible translate-y-2.5 opacity-0",
                      activeIndex !== index && "pointer-events-none"
                    )}
                  >
                    {chapter.demo}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function StoryHeading({ id }: { id: string }) {
  return (
    <div className="mb-8 max-w-3xl">
      <p className="text-[13px] font-medium text-[var(--color-accent)]">
        一条完整的学习工作流
      </p>
      <h2
        id={id}
        className="mt-3 text-[clamp(2rem,4vw,3.6rem)] font-semibold leading-[1.06] tracking-[-0.035em] text-[var(--color-text-primary)]"
        style={{ textWrap: "balance" }}
      >
        从一份资料开始，走到可交付的成果
      </h2>
    </div>
  );
}

function StoryRail({
  activeIndex,
  progressRef,
}: {
  activeIndex: number;
  progressRef: React.RefObject<HTMLSpanElement | null>;
}) {
  return (
    <div className="relative flex justify-center" aria-hidden="true">
      <span className="absolute inset-y-2 w-px bg-[var(--color-border-light)]" />
      <span
        ref={progressRef}
        className="absolute inset-x-auto top-2 h-[calc(100%-1rem)] w-px bg-[var(--color-accent)]"
      />
      <ol className="relative flex h-full flex-col justify-between py-1">
        {STORY_CHAPTERS.map((chapter, index) => (
          <li
            key={chapter.id}
            className={cn(
              "flex size-7 items-center justify-center rounded-full bg-[var(--color-bg)] text-[11px] font-medium tabular-nums ring-1 transition-[color,background-color] duration-200",
              index <= activeIndex
                ? "text-[var(--color-accent)] ring-[var(--color-accent)]"
                : "text-[var(--color-text-tertiary)] ring-[var(--color-border-light)]"
            )}
          >
            {chapter.index}
          </li>
        ))}
      </ol>
    </div>
  );
}

function StoryCopy({ chapter }: { chapter: StoryChapter }) {
  return (
    <>
      <div className="flex items-center gap-2 text-[13px] font-medium text-[var(--color-accent)]">
        {chapter.icon}
        <span>{chapter.label}</span>
      </div>
      <h3
        className="mt-5 max-w-[14ch] text-[clamp(1.8rem,3vw,2.8rem)] font-semibold leading-[1.08] tracking-[-0.03em] text-[var(--color-text-primary)]"
        style={{ textWrap: "balance" }}
      >
        {chapter.title}
      </h3>
      <p className="mt-5 max-w-[38ch] text-[16px] leading-7 text-[var(--color-text-secondary)]">
        {chapter.description}
      </p>
      <p className="mt-5 max-w-[40ch] text-[13px] leading-6 text-[var(--color-text-tertiary)]">
        {chapter.detail}
      </p>
    </>
  );
}

function MobileStory({ reducedMotion }: { reducedMotion: boolean }) {
  return (
    <div className="py-24 lg:hidden">
      <div className="px-4 sm:px-6">
        <StoryHeading id="product-story-title-mobile" />
      </div>
      <div
        className={cn(
          "flex gap-4 px-4 pb-4 sm:px-6",
          reducedMotion
            ? "flex-col gap-16"
            : "snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        )}
        aria-label="产品工作流"
      >
        {STORY_CHAPTERS.map((chapter) => (
          <article
            key={chapter.id}
            className={cn(
              "max-w-[680px]",
              reducedMotion
                ? "w-full"
                : "w-[calc(100vw-2rem)] shrink-0 snap-center sm:w-[calc(100vw-3rem)]"
            )}
          >
            <div className="mb-7">
              <span className="text-[12px] font-medium tabular-nums text-[var(--color-text-tertiary)]">
                {chapter.index} / 03
              </span>
              <StoryCopy chapter={chapter} />
            </div>
            <div className="h-[460px] overflow-hidden rounded-[24px] bg-[var(--color-surface)] ring-1 ring-[var(--color-border-light)] sm:h-[540px]">
              {chapter.demo}
            </div>
          </article>
        ))}
      </div>
      {!reducedMotion && (
        <p className="mt-3 px-4 text-[12px] text-[var(--color-text-tertiary)] sm:px-6">
          横向滑动查看完整工作流
        </p>
      )}
    </div>
  );
}

function ReducedMotionStory() {
  return (
    <div className="mx-auto hidden w-full max-w-7xl px-6 py-24 lg:block xl:px-8">
      <StoryHeading id="product-story-title-reduced" />
      <div className="mt-16 space-y-24">
        {STORY_CHAPTERS.map((chapter) => (
          <article
            key={chapter.id}
            className="grid items-center gap-12 lg:grid-cols-[minmax(260px,0.72fr)_minmax(0,1.65fr)] xl:gap-20"
          >
            <div>
              <span className="mb-5 block text-[12px] font-medium tabular-nums text-[var(--color-text-tertiary)]">
                {chapter.index} / 03
              </span>
              <StoryCopy chapter={chapter} />
            </div>
            <div className="h-[580px] overflow-hidden rounded-[28px] bg-[var(--color-surface)] ring-1 ring-[var(--color-border-light)]">
              {chapter.demo}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
