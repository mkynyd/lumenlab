import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  NOW,
  fixtureWrongAnswerItems,
} from "@/components/learning/__fixtures__/learning-fixtures";
import type { WrongAnswerItemDto } from "@/lib/hooks/use-learning-api";
import { WrongAnswerList } from "@/components/learning/wrong-answer-list";

const [unresolvedItem, resolvedItem] = fixtureWrongAnswerItems;

function latestAttempt(item: WrongAnswerItemDto) {
  return item.attempts[item.attempts.length - 1];
}

describe("WrongAnswerList", () => {
  it("renders unresolved items expanded with verdict, error type and attempts", () => {
    render(<WrongAnswerList items={fixtureWrongAnswerItems} />);

    expect(
      screen.getByText(unresolvedItem.feedback.practiceItem.prompt)
    ).toBeInTheDocument();
    expect(screen.getAllByText("回答错误").length).toBeGreaterThan(0);
    expect(screen.getByText("概念误解")).toBeInTheDocument();
    expect(
      screen.getByText("中序遍历先访问左子树，再访问根。")
    ).toBeInTheDocument();
    expect(screen.getByText("作答 1 次")).toBeInTheDocument();
    expect(screen.getByText("二叉树遍历")).toBeInTheDocument();
  });

  it("keeps resolved items inside a collapsed details section", async () => {
    const user = userEvent.setup();
    render(<WrongAnswerList items={fixtureWrongAnswerItems} />);

    const summary = screen.getByText("已解决 1");
    const details = summary.closest("details");
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute("open");
    expect(
      within(details as HTMLElement).getByText(
        resolvedItem.feedback.practiceItem.prompt
      )
    ).toBeInTheDocument();

    await user.click(summary);
    expect(details).toHaveAttribute("open");
    // The resolved item's latest verdict is partial.
    expect(
      within(details as HTMLElement).getAllByText("部分正确").length
    ).toBeGreaterThan(0);
    // Its latest evaluation is correct with errorType null, so no error type.
    expect(screen.queryByText("计算或操作失误")).not.toBeInTheDocument();
  });

  it("shows a neutral assistance hint only when the latest attempt used assistance", () => {
    const hintedItem: WrongAnswerItemDto = {
      ...unresolvedItem,
      itemLineageId: "item-lineage-hinted",
      attempts: [
        {
          ...latestAttempt(unresolvedItem),
          id: "attempt-hinted",
          assistanceLevel: "hinted",
        },
      ],
    };
    const exposedItem: WrongAnswerItemDto = {
      ...unresolvedItem,
      itemLineageId: "item-lineage-exposed",
      attempts: [
        {
          ...latestAttempt(unresolvedItem),
          id: "attempt-exposed",
          assistanceLevel: "answer_exposed",
        },
      ],
    };
    render(
      <WrongAnswerList items={[unresolvedItem, hintedItem, exposedItem]} />
    );

    const independentLi = screen
      .getAllByText(unresolvedItem.feedback.practiceItem.prompt)[0]
      .closest("li") as HTMLElement;
    expect(
      within(independentLi).queryByText(/最近一次作答/)
    ).not.toBeInTheDocument();

    expect(screen.getByText("最近一次作答使用了提示")).toBeInTheDocument();
    expect(screen.getByText("最近一次作答前查看过解析")).toBeInTheDocument();
  });

  it("keeps the explanation behind a details toggle and never leaks criteria", () => {
    const { container } = render(
      <WrongAnswerList items={fixtureWrongAnswerItems} />
    );

    const unresolvedLi = screen
      .getByText(unresolvedItem.feedback.practiceItem.prompt)
      .closest("li") as HTMLElement;
    const explanationSummary = within(unresolvedLi).getByText("解析");
    const explanationDetails = explanationSummary.closest("details");
    expect(explanationDetails).not.toBeNull();
    expect(
      within(explanationDetails as HTMLElement).getByText(
        unresolvedItem.feedback.explanation!
      )
    ).toBeInTheDocument();

    expect(container.innerHTML).not.toContain("answerCriteria");
    expect(container.innerHTML).not.toContain("generationMetadata");
  });

  it("lists each attempt with date, assistance and verdict in the history", () => {
    render(<WrongAnswerList items={fixtureWrongAnswerItems} />);

    const unresolvedLi = screen
      .getByText(unresolvedItem.feedback.practiceItem.prompt)
      .closest("li") as HTMLElement;
    const historySummary = within(unresolvedLi).getByText("作答历史");
    const historyDetails = historySummary.closest("details") as HTMLElement;
    expect(historyDetails).not.toBeNull();
    const submittedDate = new Date(NOW).toLocaleDateString("zh-CN");
    expect(
      within(historyDetails).getByText(submittedDate)
    ).toBeInTheDocument();
    expect(within(historyDetails).getByText("独立作答")).toBeInTheDocument();
    expect(within(historyDetails).getByText("回答错误")).toBeInTheDocument();

    // The resolved item keeps both attempts visible in its history.
    const resolvedDetails = screen
      .getByText("已解决 1")
      .closest("details") as HTMLElement;
    const resolvedHistorySummary =
      within(resolvedDetails).getByText("作答历史");
    const resolvedHistory = resolvedHistorySummary.closest(
      "details"
    ) as HTMLElement;
    expect(
      within(resolvedHistory).getByText(
        new Date("2026-07-29T08:00:00.000Z").toLocaleDateString("zh-CN")
      )
    ).toBeInTheDocument();
    expect(within(resolvedHistory).getByText("看过提示")).toBeInTheDocument();
    expect(within(resolvedHistory).getByText("回答正确")).toBeInTheDocument();
  });

  it("falls back to a neutral label for unknown error types", () => {
    const unknownItem: WrongAnswerItemDto = {
      ...unresolvedItem,
      itemLineageId: "item-lineage-unknown",
      attempts: [
        {
          ...latestAttempt(unresolvedItem),
          id: "attempt-unknown",
          evaluations: [
            {
              ...latestAttempt(unresolvedItem).evaluations[0],
              id: "evaluation-unknown",
              errorType: "brand_new_type",
            },
          ],
        },
      ],
    };
    render(<WrongAnswerList items={[unknownItem]} />);

    expect(screen.getByText("其他原因")).toBeInTheDocument();
    expect(screen.queryByText("brand_new_type")).not.toBeInTheDocument();
  });

  it("does not expose an internal evaluation reason code", () => {
    const codedItem: WrongAnswerItemDto = {
      ...unresolvedItem,
      itemLineageId: "item-lineage-coded-reason",
      attempts: [
        {
          ...latestAttempt(unresolvedItem),
          id: "attempt-coded-reason",
          evaluations: [
            {
              ...latestAttempt(unresolvedItem).evaluations[0],
              id: "evaluation-coded-reason",
              reason: "boolean_mismatch",
            },
          ],
        },
      ],
    };

    render(<WrongAnswerList items={[codedItem]} />);

    expect(screen.getByText("判断与正确答案不一致")).toBeInTheDocument();
    expect(screen.queryByText("boolean_mismatch")).not.toBeInTheDocument();
  });

  it("renders a corrected wrong answer with a learner-facing verdict", () => {
    const correctedItem: WrongAnswerItemDto = {
      ...resolvedItem,
      itemLineageId: "item-lineage-corrected",
      latestVerdict: "correct",
    };

    render(<WrongAnswerList items={[correctedItem]} />);

    const resolvedDetails = screen
      .getByText("已解决 1")
      .closest("details") as HTMLElement;
    expect(
      within(resolvedDetails).getAllByText("回答正确").length
    ).toBeGreaterThan(0);
    expect(within(resolvedDetails).queryByText("correct")).not.toBeInTheDocument();
  });

  it("shows the empty state when there are no items", () => {
    render(<WrongAnswerList items={[]} />);

    expect(screen.getByText("还没有错题")).toBeInTheDocument();
  });
});
