import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PracticeFeedback } from "@/components/learning/practice-feedback";
import type { AttemptResultDto } from "@/lib/hooks/use-learning-api";
import { fixtureAttemptResult } from "@/components/learning/__fixtures__/learning-fixtures";

function makeResult(overrides: Partial<AttemptResultDto> = {}): AttemptResultDto {
  return { ...fixtureAttemptResult, ...overrides };
}

describe("PracticeFeedback", () => {
  it.each([
    ["correct", "回答正确"],
    ["partial", "部分正确"],
    ["incorrect", "回答错误"],
    ["uncertain", "暂时无法判定，可以稍后重新作答"],
  ] as const)("verdict %s 显示文案「%s」", (verdict, label) => {
    render(
      <PracticeFeedback
        result={makeResult({
          evaluation: { ...fixtureAttemptResult.evaluation, verdict },
        })}
      />
    );

    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("渲染 evaluation.reason 与解析小节", () => {
    render(<PracticeFeedback result={makeResult()} />);

    expect(
      screen.getByText("中序遍历先访问左子树，再访问根。")
    ).toBeInTheDocument();
    expect(screen.getByText("解析")).toBeInTheDocument();
    expect(
      screen.getByText("中序遍历顺序为左-根-右，因此结果为左根右。")
    ).toBeInTheDocument();
  });

  it("将内部评分原因码转换为学习者可读文案", () => {
    render(
      <PracticeFeedback
        result={makeResult({
          evaluation: {
            ...fixtureAttemptResult.evaluation,
            reason: "boolean_matches",
          },
        })}
      />
    );

    expect(screen.getByText("判断与正确答案一致")).toBeInTheDocument();
    expect(screen.queryByText("boolean_matches")).not.toBeInTheDocument();
  });

  it("不会把未知的内部评分码直接展示给学习者", () => {
    render(
      <PracticeFeedback
        result={makeResult({
          evaluation: {
            ...fixtureAttemptResult.evaluation,
            reason: "new_internal_reason",
          },
        })}
      />
    );

    expect(
      screen.getByText("系统已根据评分规则完成判定")
    ).toBeInTheDocument();
    expect(screen.queryByText("new_internal_reason")).not.toBeInTheDocument();
  });

  it("无 explanation 时不渲染解析小节", () => {
    render(
      <PracticeFeedback
        result={makeResult({
          feedback: { ...fixtureAttemptResult.feedback, explanation: null },
        })}
      />
    );

    expect(screen.queryByText("解析")).not.toBeInTheDocument();
  });

  it("显示来源数量但不渲染 hash", () => {
    const { container } = render(<PracticeFeedback result={makeResult()} />);

    expect(screen.getByText("来源 1 处")).toBeInTheDocument();
    expect(container.innerHTML).not.toContain("sha256");
  });

  it("使用辅助时显示权重提示", () => {
    render(
      <PracticeFeedback
        result={makeResult({
          attempt: {
            ...fixtureAttemptResult.attempt,
            assistanceLevel: "hinted",
          },
        })}
      />
    );

    expect(
      screen.getByText("本次作答使用了辅助，对掌握度的影响会降低")
    ).toBeInTheDocument();
  });

  it("answer_exposed 使用同一权重提示", () => {
    render(
      <PracticeFeedback
        result={makeResult({
          attempt: {
            ...fixtureAttemptResult.attempt,
            assistanceLevel: "answer_exposed",
          },
        })}
      />
    );

    expect(
      screen.getByText("本次作答使用了辅助，对掌握度的影响会降低")
    ).toBeInTheDocument();
  });

  it("独立作答时不显示权重提示", () => {
    render(<PracticeFeedback result={makeResult()} />);

    expect(
      screen.queryByText("本次作答使用了辅助，对掌握度的影响会降低")
    ).not.toBeInTheDocument();
  });

  it("feedback_only 的题显示不影响掌握度", () => {
    render(
      <PracticeFeedback
        result={makeResult({
          feedback: {
            ...fixtureAttemptResult.feedback,
            practiceItem: {
              ...fixtureAttemptResult.feedback.practiceItem,
              mode: "feedback_only",
            },
          },
        })}
      />
    );

    expect(screen.getByText("此反馈不影响掌握度")).toBeInTheDocument();
  });
});
