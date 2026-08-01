/* eslint-disable @typescript-eslint/no-explicit-any */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StudyPacksView } from "@/components/learning/study-packs-view";
import {
  useCreateStudyPack,
  useGenerateStudyPack,
  usePublishStudyPack,
  useRegenerateStudyPackSection,
  useSaveStudyPackSection,
  useStudyPack,
  useStudyPacks,
  useUpdateStudyPackOutline,
} from "@/lib/hooks/use-learning-study-packs";

vi.mock("@/lib/hooks/use-learning-study-packs", () => ({
  useStudyPacks: vi.fn(),
  useCreateStudyPack: vi.fn(),
  useStudyPack: vi.fn(),
  useUpdateStudyPackOutline: vi.fn(),
  useGenerateStudyPack: vi.fn(),
  useSaveStudyPackSection: vi.fn(),
  useRegenerateStudyPackSection: vi.fn(),
  usePublishStudyPack: vi.fn(),
}));

const mockUseStudyPacks = vi.mocked(useStudyPacks);
const mockUseCreateStudyPack = vi.mocked(useCreateStudyPack);
const mockUseStudyPack = vi.mocked(useStudyPack);
const mockUseUpdateStudyPackOutline = vi.mocked(useUpdateStudyPackOutline);
const mockUseGenerateStudyPack = vi.mocked(useGenerateStudyPack);
const mockUseSaveStudyPackSection = vi.mocked(useSaveStudyPackSection);
const mockUseRegenerateStudyPackSection = vi.mocked(
  useRegenerateStudyPackSection
);
const mockUsePublishStudyPack = vi.mocked(usePublishStudyPack);

const createMutate = vi.fn();
const outlineMutate = vi.fn();
const generateMutate = vi.fn();
const saveSectionMutate = vi.fn();
const regenerateMutate = vi.fn();
const publishMutate = vi.fn();

const fixturePack = {
  id: "pack-1",
  goalId: "goal-1",
  title: "电路基础 · 学习资料包",
  outline: [
    { key: "kcl", title: "节点电流定律", description: null },
  ],
  outlineStatus: "confirmed" as const,
  sourceFingerprint: "sha256:map",
  publishedArtifactId: null,
  createdAt: "2026-08-01T08:00:00.000Z",
  updatedAt: "2026-08-01T08:00:00.000Z",
  sections: [
    {
      id: "section-1",
      key: "kcl",
      orderIndex: 0,
      title: "节点电流定律",
      description: null,
      status: "ready",
      content: "# 节点电流定律\n\n## 核心要点\n- 流入等于流出",
      userEdited: false,
      userEditedAt: null,
      failureReason: null,
      createdAt: "2026-08-01T08:00:00.000Z",
      updatedAt: "2026-08-01T08:00:00.000Z",
    },
  ],
};

function mockPacks(overrides: Record<string, unknown>) {
  mockUseStudyPacks.mockReturnValue({
    data: [fixturePack],
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  } as any);
}

function mockDefaultMutations() {
  mockUseCreateStudyPack.mockReturnValue({
    mutate: createMutate,
    isPending: false,
    isError: false,
  } as any);
  mockUseUpdateStudyPackOutline.mockReturnValue({
    mutate: outlineMutate,
    isPending: false,
    isError: false,
  } as any);
  mockUseGenerateStudyPack.mockReturnValue({
    mutate: generateMutate,
    isPending: false,
    isError: false,
    isSuccess: false,
  } as any);
  mockUseSaveStudyPackSection.mockReturnValue({
    mutate: saveSectionMutate,
    isPending: false,
    isError: false,
  } as any);
  mockUseRegenerateStudyPackSection.mockReturnValue({
    mutate: regenerateMutate,
    isPending: false,
    isError: false,
  } as any);
  mockUsePublishStudyPack.mockReturnValue({
    mutate: publishMutate,
    isPending: false,
    isError: false,
    isSuccess: false,
  } as any);
}

describe("StudyPacksView", () => {
  beforeEach(() => {
    createMutate.mockReset();
    outlineMutate.mockReset();
    generateMutate.mockReset();
    saveSectionMutate.mockReset();
    regenerateMutate.mockReset();
    publishMutate.mockReset();
    mockUseStudyPack.mockReturnValue({ data: undefined, isPending: false } as any);
    mockDefaultMutations();
  });

  it("加载中显示可访问的加载状态", () => {
    mockPacks({ isPending: true });

    render(<StudyPacksView projectId="project-1" goalId="goal-1" />);

    expect(screen.getByRole("status")).toHaveTextContent("加载中…");
  });

  it("没有资料包时显示引导文案", () => {
    mockPacks({ data: [] });

    render(<StudyPacksView projectId="project-1" goalId="goal-1" />);

    expect(screen.getByText(/还没有资料包/)).toBeInTheDocument();
  });

  it("列表展示资料包并可点击进入详情", async () => {
    mockPacks({ data: [fixturePack] });
    mockUseStudyPack.mockReturnValue({
      data: fixturePack,
      isPending: false,
    } as any);
    const user = userEvent.setup();

    render(<StudyPacksView projectId="project-1" goalId="goal-1" />);

    expect(screen.getByText("电路基础 · 学习资料包")).toBeInTheDocument();
    expect(screen.getByText("大纲已确认")).toBeInTheDocument();

    await user.click(screen.getByText("电路基础 · 学习资料包"));
    expect(screen.getByText("生成全部章节")).toBeInTheDocument();
    expect(screen.getByText("节点电流定律")).toBeInTheDocument();
    expect(screen.getByText("已完成")).toBeInTheDocument();
    expect(screen.getByText("发布为成果")).toBeInTheDocument();
  });

  it("创建资料包携带 idempotency 参数", async () => {
    mockPacks({ data: [] });
    const user = userEvent.setup();

    render(<StudyPacksView projectId="project-1" goalId="goal-1" />);

    await user.click(screen.getByRole("button", { name: "新建资料包" }));
    expect(createMutate).toHaveBeenCalledTimes(1);
    expect(createMutate.mock.calls[0][0]).toEqual({});
  });

  it("资料包加载失败可重试", () => {
    mockPacks({ isError: true });

    render(<StudyPacksView projectId="project-1" goalId="goal-1" />);

    expect(screen.getByText("资料包加载失败")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
  });
});
