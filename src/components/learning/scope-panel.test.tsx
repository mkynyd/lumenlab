import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScopePanel } from "@/components/learning/scope-panel";
import { ApiError } from "@/lib/api/client";
import {
  useConfirmScope,
  useLearningScope,
  useSaveScopeDraft,
} from "@/lib/hooks/use-learning-goals";
import { useProjectFiles } from "@/lib/hooks/use-project-files";
import type { LearningScopeDto } from "@/lib/hooks/use-learning-api";
import {
  fixtureScopeConfirmed,
  fixtureScopeDraft,
} from "@/components/learning/__fixtures__/learning-fixtures";

vi.mock("@/lib/hooks/use-learning-goals", () => ({
  useLearningScope: vi.fn(),
  useSaveScopeDraft: vi.fn(),
  useConfirmScope: vi.fn(),
}));

vi.mock("@/lib/hooks/use-project-files", () => ({
  useProjectFiles: vi.fn(),
}));

const defaultFiles = [
  { id: "file-1", originalName: "第6章讲义.pdf", status: "parsed" },
  { id: "file-2", originalName: "课堂录音.mp3", status: "processing" },
  { id: "file-3", originalName: "习题解析.docx", status: "partial" },
];

interface SetupOptions {
  scope?: LearningScopeDto | null;
  files?: typeof defaultFiles;
  savePending?: boolean;
  confirmPending?: boolean;
  saveError?: Error | null;
  confirmError?: Error | null;
}

function setup({
  scope = null,
  files = defaultFiles,
  savePending = false,
  confirmPending = false,
  saveError = null,
  confirmError = null,
}: SetupOptions = {}) {
  const saveMutate = vi.fn();
  const confirmMutate = vi.fn();
  vi.mocked(useLearningScope).mockReturnValue({
    data: scope,
    isLoading: false,
  } as unknown as ReturnType<typeof useLearningScope>);
  vi.mocked(useSaveScopeDraft).mockReturnValue({
    mutate: saveMutate,
    isPending: savePending,
    error: saveError,
  } as unknown as ReturnType<typeof useSaveScopeDraft>);
  vi.mocked(useConfirmScope).mockReturnValue({
    mutate: confirmMutate,
    isPending: confirmPending,
    error: confirmError,
  } as unknown as ReturnType<typeof useConfirmScope>);
  vi.mocked(useProjectFiles).mockReturnValue({
    data: files,
  } as unknown as ReturnType<typeof useProjectFiles>);
  return { saveMutate, confirmMutate };
}

describe("ScopePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("defaults to the whole-corpus material mode", () => {
    setup();

    render(<ScopePanel projectId="project-1" goalId="goal-1" />);

    expect(screen.getByRole("radio", { name: "全部可读资料" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "选定资料" })).not.toBeChecked();
  });

  it("only lists parsed or partially parsed files as selectable", async () => {
    const user = userEvent.setup();
    setup({ scope: fixtureScopeDraft });

    render(<ScopePanel projectId="project-1" goalId="goal-1" />);
    await user.click(screen.getByRole("radio", { name: "选定资料" }));

    expect(screen.getByRole("checkbox", { name: "第6章讲义.pdf" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "习题解析.docx" })).toBeInTheDocument();
    expect(screen.queryByText("课堂录音.mp3")).not.toBeInTheDocument();
  });

  it("disables confirm with a hint when selected-files mode has no selection", async () => {
    const user = userEvent.setup();
    setup({ scope: fixtureScopeDraft });

    render(<ScopePanel projectId="project-1" goalId="goal-1" />);

    expect(screen.getByRole("button", { name: "确认学习范围" })).toBeEnabled();

    await user.click(screen.getByRole("radio", { name: "选定资料" }));

    expect(screen.getByRole("button", { name: "确认学习范围" })).toBeDisabled();
    expect(screen.getByText("请先选择至少一份资料")).toBeInTheDocument();
  });

  it("saves a draft with expectedVersion 0 when no scope exists yet", async () => {
    const user = userEvent.setup();
    const { saveMutate } = setup();

    render(<ScopePanel projectId="project-1" goalId="goal-1" />);
    await user.click(screen.getByRole("button", { name: "保存草稿" }));

    expect(saveMutate).toHaveBeenCalledTimes(1);
    const variables = saveMutate.mock.calls[0][0] as Record<string, unknown>;
    expect(variables).toEqual({
      expectedVersion: 0,
      materialMode: "project_corpus",
      fileIds: [],
      definition: {},
      materialGaps: [],
      idempotencyKey: expect.any(String),
    });
  });

  it("saves a draft with the current scope version and the note in definition", async () => {
    const user = userEvent.setup();
    const { saveMutate } = setup({ scope: fixtureScopeDraft });

    render(<ScopePanel projectId="project-1" goalId="goal-1" />);
    await user.type(screen.getByLabelText("补充说明"), "重点复习图论");
    await user.click(screen.getByRole("button", { name: "保存草稿" }));

    const variables = saveMutate.mock.calls[0][0] as Record<string, unknown>;
    expect(variables.expectedVersion).toBe(1);
    expect(variables.definition).toEqual({ note: "重点复习图论" });
    expect(variables.materialGaps).toEqual(["缺少第 7 章讲义"]);
  });

  it("confirms the draft scope with its version", async () => {
    const user = userEvent.setup();
    const { confirmMutate } = setup({ scope: fixtureScopeDraft });

    render(<ScopePanel projectId="project-1" goalId="goal-1" />);
    await user.click(screen.getByRole("button", { name: "确认学习范围" }));

    expect(confirmMutate).toHaveBeenCalledTimes(1);
    expect(confirmMutate.mock.calls[0][0]).toEqual({
      expectedVersion: 1,
      idempotencyKey: expect.any(String),
    });
  });

  it("renders a confirmed scope as a read-only summary with material gaps", () => {
    setup({ scope: fixtureScopeConfirmed });

    render(<ScopePanel projectId="project-1" goalId="goal-1" />);

    expect(screen.getByText("已确认")).toBeInTheDocument();
    expect(screen.getByText("全部可读资料")).toBeInTheDocument();
    expect(screen.getByText("资料缺口")).toBeInTheDocument();
    expect(screen.getByText("缺少第 7 章讲义")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存草稿" })).not.toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });

  it("echoes an existing selected-files draft", () => {
    setup({
      scope: {
        ...fixtureScopeDraft,
        materialMode: "selected_files",
        fileIds: ["file-1"],
        definition: { note: "只看第 6 章" },
      },
    });

    render(<ScopePanel projectId="project-1" goalId="goal-1" />);

    expect(screen.getByRole("radio", { name: "选定资料" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "第6章讲义.pdf" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "习题解析.docx" })).not.toBeChecked();
    expect(screen.getByLabelText("补充说明")).toHaveValue("只看第 6 章");
  });

  it("passes through localized server error messages", () => {
    setup({
      scope: fixtureScopeDraft,
      saveError: new ApiError("请求失败 (409)", 409, {
        error: { code: "invalid_state", message: "版本冲突，请刷新后重试" },
      }),
    });

    render(<ScopePanel projectId="project-1" goalId="goal-1" />);

    expect(screen.getByRole("alert")).toHaveTextContent("版本冲突，请刷新后重试");
  });

  it("never shows raw network error messages", () => {
    setup({
      scope: fixtureScopeDraft,
      saveError: new TypeError("Failed to fetch"),
    });

    render(<ScopePanel projectId="project-1" goalId="goal-1" />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "网络异常或服务暂时不可用，请稍后重试。"
    );
    expect(screen.queryByText(/Failed to fetch/)).not.toBeInTheDocument();
  });

  it("reuses the draft key for identical saves but rotates it after edits", async () => {
    const user = userEvent.setup();
    const { saveMutate } = setup({ scope: fixtureScopeDraft });

    render(<ScopePanel projectId="project-1" goalId="goal-1" />);
    const saveButton = screen.getByRole("button", { name: "保存草稿" });
    await user.click(saveButton);
    await user.click(saveButton);

    const firstKey = (saveMutate.mock.calls[0][0] as { idempotencyKey: string })
      .idempotencyKey;
    const secondKey = (saveMutate.mock.calls[1][0] as { idempotencyKey: string })
      .idempotencyKey;
    expect(secondKey).toBe(firstKey);

    await user.click(screen.getByRole("radio", { name: "选定资料" }));
    await user.click(screen.getByRole("checkbox", { name: "第6章讲义.pdf" }));
    await user.click(saveButton);

    const thirdKey = (saveMutate.mock.calls[2][0] as { idempotencyKey: string })
      .idempotencyKey;
    expect(thirdKey).not.toBe(firstKey);
  });
});
