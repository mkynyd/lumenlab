import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { KnowledgeMapView } from "@/components/learning/knowledge-map-view";
import { fixtureKnowledgeMap } from "@/components/learning/__fixtures__/learning-fixtures";

describe("KnowledgeMapView", () => {
  it("shows the empty state with a generate action when there is no map", async () => {
    const user = userEvent.setup();
    const onGenerate = vi.fn();

    render(<KnowledgeMapView map={null} onGenerate={onGenerate} />);

    expect(screen.getByText("还没有知识点地图")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "生成知识点地图" }));
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });

  it("disables the generate button while generating", () => {
    render(<KnowledgeMapView map={null} onGenerate={vi.fn()} isGenerating />);

    const button = screen.getByRole("button", { name: "生成中…" });
    expect(button).toBeDisabled();
  });

  it("omits the action when onGenerate is not provided", () => {
    render(<KnowledgeMapView map={null} />);

    expect(screen.getByText("还没有知识点地图")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders the version, point count and point rows", () => {
    render(<KnowledgeMapView map={fixtureKnowledgeMap} />);

    expect(screen.getByText("共 3 个知识点")).toBeInTheDocument();
    expect(screen.getByText("二叉树遍历")).toBeInTheDocument();
    expect(screen.getByText("图的遍历")).toBeInTheDocument();
    expect(screen.getByText("排序算法复杂度")).toBeInTheDocument();
    expect(screen.getAllByText("概念")).toHaveLength(2);
    expect(screen.getByText("技能")).toBeInTheDocument();
    expect(screen.queryByText("concept")).not.toBeInTheDocument();
    expect(screen.getByText("资料待更新")).toBeInTheDocument();
    expect(screen.getAllByText("1 个来源")).toHaveLength(2);
  });

  it("downgrades unsupported points to tertiary text", () => {
    render(<KnowledgeMapView map={fixtureKnowledgeMap} />);

    expect(screen.getByText("排序算法复杂度")).toHaveClass(
      "text-[var(--color-text-tertiary)]"
    );
    expect(screen.getByText("二叉树遍历")).not.toHaveClass(
      "text-[var(--color-text-tertiary)]"
    );
    expect(screen.getByText("资料不可用")).toBeInTheDocument();
  });
});
