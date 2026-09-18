import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  templatesQuery: vi.fn(),
  submit: vi.fn(),
}));

vi.mock("@/lib/hooks/use-formatting", () => ({
  useFormattingTemplates: () => mocks.templatesQuery(),
  useSubmitFormatting: () => mocks.submit(),
}));

import { PaperTypesetting } from "./paper-typesetting";

function variant(id: string, canSubmit: boolean, reason: string | null = null) {
  return { id, variantKey: `${id}-key`, adapterId: null, canSubmit, reason, verified: canSubmit, hasLatex: true, requiredMetadata: ["title", "authors"], sampleAvailable: canSubmit };
}

function template(id: string, university: string, variants: ReturnType<typeof variant>[]) {
  return { id, university, degreeType: "本科", year: "2026", format: "latex", repositoryUrl: null, officialSpecUrl: null, status: "active", variants };
}

function queryState(overrides: Record<string, unknown>) {
  return { data: undefined, isPending: false, isError: false, isRefetching: false, refetch: vi.fn(), ...overrides };
}

describe("PaperTypesetting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.submit.mockReturnValue({ isPending: false, mutateAsync: vi.fn() });
    mocks.templatesQuery.mockReturnValue(queryState({
      data: { templates: [template("t1", "重庆大学", [variant("v1", true)])], counts: { records: 1, variants: 1, latex: 1, verified: 1, submittable: 1 } },
    }));
  });

  it("默认只显示可提交模板，可通过开关查看全部并看到不可用原因", async () => {
    mocks.templatesQuery.mockReturnValue(queryState({
      data: {
        templates: [
          template("t1", "重庆大学", [variant("v1", true)]),
          template("t2", "四川大学", [variant("v2", false, "尚未通过当前快照的隔离排版验证")]),
        ],
        counts: { records: 2, variants: 2, latex: 2, verified: 1, submittable: 1 },
      },
    }));
    const user = userEvent.setup();
    render(<PaperTypesetting />);

    expect(screen.getByText("重庆大学")).toBeInTheDocument();
    expect(screen.queryByText("四川大学")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "只显示可提交模板" }));
    expect(screen.getByText("四川大学")).toBeInTheDocument();

    const disabledButton = screen.getByRole("button", { name: "v2-key" });
    expect(disabledButton).toBeDisabled();
    const describedBy = disabledButton.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy ?? "")).toHaveTextContent("尚未通过当前快照的隔离排版验证");
  });

  it("选中可提交模板后按钮带 aria-pressed", async () => {
    const user = userEvent.setup();
    render(<PaperTypesetting />);

    const variantButton = screen.getByRole("button", { name: "v1-key" });
    expect(variantButton).toHaveAttribute("aria-pressed", "false");
    await user.click(variantButton);
    expect(variantButton).toHaveAttribute("aria-pressed", "true");
  });

  it("库中没有可提交模板时显示前置引导并隐藏后续步骤", () => {
    mocks.templatesQuery.mockReturnValue(queryState({
      data: {
        templates: [template("t1", "重庆大学", [variant("v1", false, "尚未通过当前快照的隔离排版验证")])],
        counts: { records: 1, variants: 1, latex: 1, verified: 0, submittable: 0 },
      },
    }));
    render(<PaperTypesetting />);

    expect(screen.getByText("模板库正在验证，暂未开放提交")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "去聊天，让 AI 按学校要求帮你排版" })).toHaveAttribute("href", "/chat");
    expect(screen.getByRole("link", { name: "查看模板验证进度" })).toHaveAttribute("href", "/papers/templates");
    expect(screen.queryByLabelText("论文题目")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("上传论文原稿")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /提交后台排版/ })).not.toBeInTheDocument();
  });

  it("模板列表请求失败时提供重试按钮", async () => {
    const refetch = vi.fn();
    const user = userEvent.setup();
    mocks.templatesQuery.mockReturnValue(queryState({ isError: true, refetch }));
    render(<PaperTypesetting />);

    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(refetch).toHaveBeenCalled();
  });
});
