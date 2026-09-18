import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ templates: vi.fn() }));

vi.mock("@/lib/hooks/use-papers", () => ({
  usePaperTemplates: (...args: unknown[]) => mocks.templates(...args),
}));

import PaperTemplatesPage from "./page";

function variant(id: string, validationStatus: string) {
  return { id, variantKey: `${id}-key`, status: "active", validation: { status: validationStatus, sampleCompileAt: "2026-09-01T00:00:00Z" }, sample: null };
}

function record(id: string, university: string, variants: ReturnType<typeof variant>[], recommendationLevel = "A") {
  return { id, externalId: id, university, degreeType: "本科", year: "2026", format: "latex", recommendationLevel, status: "active", repositoryUrl: "https://github.com/example/repo", officialSpecUrl: null, variants };
}

function queryState(overrides: Record<string, unknown>) {
  return { data: undefined, isPending: false, isError: false, isRefetching: false, refetch: vi.fn(), ...overrides };
}

describe("PaperTemplatesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("默认只显示可排版模板，状态 pill 中文化且只有一处状态说明", () => {
    mocks.templates.mockReturnValue(queryState({
      data: [
        record("t1", "重庆大学", [variant("v1", "Verified")]),
        record("t2", "四川大学", [variant("v2", "Needs Review")]),
      ],
    }));
    render(<PaperTemplatesPage />);

    expect(screen.getByText("重庆大学")).toBeInTheDocument();
    expect(screen.queryByText("四川大学")).not.toBeInTheDocument();
    expect(screen.getByText("已验证")).toBeInTheDocument();
    expect(screen.getByText(/状态说明：已验证 = 真实样例编译通过/)).toBeInTheDocument();
    expect(screen.queryByText("Verified")).not.toBeInTheDocument();
    expect(screen.queryByText("Registry")).not.toBeInTheDocument();
  });

  it("关闭「只看可排版模板」后显示全部记录并展示中文状态", async () => {
    mocks.templates.mockReturnValue(queryState({
      data: [
        record("t1", "重庆大学", [variant("v1", "Verified")]),
        record("t2", "四川大学", [variant("v2", "Needs Review")]),
      ],
    }));
    const user = userEvent.setup();
    render(<PaperTemplatesPage />);

    await user.click(screen.getByRole("button", { name: "只看可排版模板" }));
    expect(screen.getByText("四川大学")).toBeInTheDocument();
    expect(screen.getByText("待复核")).toBeInTheDocument();
    expect(screen.getAllByText("维护中").length).toBeGreaterThan(0);
  });

  it("没有可排版模板时显示面向学生的原因说明与出口", async () => {
    mocks.templates.mockReturnValue(queryState({
      data: [record("t1", "四川大学", [variant("v2", "Needs Review")])],
    }));
    render(<PaperTemplatesPage />);

    expect(screen.getByText("暂时没有可直接排版的模板")).toBeInTheDocument();
    expect(screen.getByText(/固定快照、隔离编译、真实样例排版/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "去聊天让 AI 帮忙排版" })).toHaveAttribute("href", "/chat");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /查看全部 1 条模板/ }));
    expect(screen.getByText("四川大学")).toBeInTheDocument();
  });

  it("超过一页的库通过「加载更多」分批展示", async () => {
    const data = Array.from({ length: 25 }, (_, index) => record(`t${index}`, `学校${index}`, [variant(`v${index}`, "Verified")]));
    mocks.templates.mockReturnValue(queryState({ data }));
    const user = userEvent.setup();
    render(<PaperTemplatesPage />);

    expect(screen.getByText("学校0")).toBeInTheDocument();
    expect(screen.getByText("学校19")).toBeInTheDocument();
    expect(screen.queryByText("学校24")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /加载更多/ }));
    expect(screen.getByText("学校24")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /加载更多/ })).not.toBeInTheDocument();
  });

  it("请求失败时提供重试按钮", async () => {
    const refetch = vi.fn();
    mocks.templates.mockReturnValue(queryState({ isError: true, refetch }));
    const user = userEvent.setup();
    render(<PaperTemplatesPage />);

    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(refetch).toHaveBeenCalled();
    expect(screen.queryByText(/没有匹配的模板记录/)).not.toBeInTheDocument();
  });
});
