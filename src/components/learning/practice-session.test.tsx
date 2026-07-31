import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PracticeSession } from "@/components/learning/practice-session";
import {
  useRecordAnswerExposure,
  useRecordHint,
  useSubmitAttempt,
} from "@/lib/hooks/use-learning-session";
import {
  expectNoSensitiveFields,
  fixtureAnswerExposure,
  fixtureAttemptResult,
  fixtureHintResult,
  fixturePracticeItem,
  fixtureSession,
} from "@/components/learning/__fixtures__/learning-fixtures";

vi.mock("@/lib/hooks/use-learning-session", () => ({
  useRecordHint: vi.fn(),
  useRecordAnswerExposure: vi.fn(),
  useSubmitAttempt: vi.fn(),
}));

const mockUseRecordHint = vi.mocked(useRecordHint);
const mockUseRecordAnswerExposure = vi.mocked(useRecordAnswerExposure);
const mockUseSubmitAttempt = vi.mocked(useSubmitAttempt);

/* eslint-disable @typescript-eslint/no-explicit-any */
const submitMutate = vi.fn();
const hintMutate = vi.fn();
const exposureMutate = vi.fn();

function renderSession(
  overrides: Partial<React.ComponentProps<typeof PracticeSession>> = {}
) {
  return render(
    <PracticeSession
      projectId="project-1"
      goalId="goal-1"
      session={fixtureSession}
      {...overrides}
    />
  );
}

describe("PracticeSession", () => {
  beforeEach(() => {
    submitMutate.mockReset();
    hintMutate.mockReset();
    exposureMutate.mockReset();
    mockUseSubmitAttempt.mockReturnValue({ mutate: submitMutate } as any);
    mockUseRecordHint.mockReturnValue({ mutate: hintMutate } as any);
    mockUseRecordAnswerExposure.mockReturnValue({ mutate: exposureMutate } as any);
  });

  it("提交前不泄露任何敏感字段", () => {
    expectNoSensitiveFields(fixtureSession);

    const { container } = renderSession();

    expect(
      screen.getByText("二叉树的中序遍历结果是什么？")
    ).toBeInTheDocument();
    expect(screen.getByText("第 1 / 6 题")).toBeInTheDocument();
    expect(container.innerHTML).not.toContain("answerCriteria");
    expect(container.innerHTML).not.toContain("generationMetadata");
    expect(container.innerHTML).not.toContain("explanation");
    expect(screen.queryByText("解析")).not.toBeInTheDocument();
  });

  it("diagnostic 模式作答阶段不显示查看答案按钮", () => {
    renderSession();

    expect(
      screen.queryByRole("button", { name: "查看答案" })
    ).not.toBeInTheDocument();
  });

  it("未作答时提交禁用，作答后提交并携带 goalId 与幂等 key", async () => {
    const user = userEvent.setup();
    renderSession();

    const submitButton = screen.getByRole("button", { name: "提交答案" });
    expect(submitButton).toBeDisabled();

    await user.click(screen.getByRole("radio", { name: "左根右" }));
    expect(submitButton).toBeEnabled();

    await user.click(submitButton);
    expect(submitMutate).toHaveBeenCalledTimes(1);
    const [variables] = submitMutate.mock.calls[0];
    expect(variables).toMatchObject({
      sessionItemId: "session-item-1",
      answer: "opt-a",
      goalId: "goal-1",
    });
    expect(typeof variables.idempotencyKey).toBe("string");
  });

  it("提交失败保留答案，重试复用同一幂等 key", async () => {
    const user = userEvent.setup();
    submitMutate
      .mockImplementationOnce((_vars: unknown, opts: any) =>
        opts.onError(new Error("网络错误"))
      )
      .mockImplementationOnce((_vars: unknown, opts: any) =>
        opts.onSuccess(fixtureAttemptResult)
      );
    renderSession();

    await user.click(screen.getByRole("radio", { name: "左根右" }));
    await user.click(screen.getByRole("button", { name: "提交答案" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "提交失败，请检查网络后重试"
    );
    expect(screen.getByRole("radio", { name: "左根右" })).toBeChecked();

    await user.click(screen.getByRole("button", { name: "提交答案" }));
    expect(await screen.findByText("回答错误")).toBeInTheDocument();

    expect(submitMutate).toHaveBeenCalledTimes(2);
    const firstKey = submitMutate.mock.calls[0][0].idempotencyKey;
    const secondKey = submitMutate.mock.calls[1][0].idempotencyKey;
    expect(firstKey).toBe(secondKey);
  });

  it("提交失败后修改答案会使用新的幂等 key", async () => {
    const user = userEvent.setup();
    submitMutate
      .mockImplementationOnce((_vars: unknown, opts: any) =>
        opts.onError(new Error("网络错误"))
      )
      .mockImplementationOnce((_vars: unknown, opts: any) =>
        opts.onSuccess(fixtureAttemptResult)
      );
    renderSession();

    await user.click(screen.getByRole("radio", { name: "左根右" }));
    await user.click(screen.getByRole("button", { name: "提交答案" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "根左右" }));
    await user.click(screen.getByRole("button", { name: "提交答案" }));

    expect(submitMutate.mock.calls[0][0].idempotencyKey).not.toBe(
      submitMutate.mock.calls[1][0].idempotencyKey
    );
  });

  it("提交成功后显示反馈（含解析）并回调 onSessionUpdated，可进入下一题", async () => {
    const user = userEvent.setup();
    const onSessionUpdated = vi.fn();
    submitMutate.mockImplementation((_vars: unknown, opts: any) =>
      opts.onSuccess(fixtureAttemptResult)
    );
    renderSession({ onSessionUpdated });

    await user.click(screen.getByRole("radio", { name: "左根右" }));
    await user.click(screen.getByRole("button", { name: "提交答案" }));

    expect(await screen.findByText("回答错误")).toBeInTheDocument();
    expect(screen.getByText("解析")).toBeInTheDocument();
    expect(
      screen.getByText("中序遍历顺序为左-根-右，因此结果为左根右。")
    ).toBeInTheDocument();
    expect(onSessionUpdated).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "下一题" }));
    expect(screen.getByText("以下哪些是图的遍历方式？")).toBeInTheDocument();
    expect(screen.getByText("第 2 / 6 题")).toBeInTheDocument();
  });

  it("提示按钮记录提示后禁用并显示提示文本", async () => {
    const user = userEvent.setup();
    hintMutate.mockImplementation((_vars: unknown, opts: any) =>
      opts.onSuccess({ ...fixtureHintResult, hint: "先想左子树" })
    );
    renderSession();

    await user.click(screen.getByRole("button", { name: "提示" }));

    expect(await screen.findByText("先想左子树")).toBeInTheDocument();
    expect(hintMutate).toHaveBeenCalledTimes(1);
    expect(hintMutate.mock.calls[0][0]).toMatchObject({
      sessionItemId: "session-item-1",
    });
    expect(
      screen.getByRole("button", { name: "已查看提示" })
    ).toBeDisabled();
  });

  it("提示请求失败后重试复用同一幂等 key", async () => {
    const user = userEvent.setup();
    hintMutate
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce((_vars: unknown, opts: any) =>
        opts.onSuccess({ ...fixtureHintResult, hint: "先想左子树" })
      );
    renderSession();

    await user.click(screen.getByRole("button", { name: "提示" }));
    await user.click(screen.getByRole("button", { name: "提示" }));

    expect(hintMutate).toHaveBeenCalledTimes(2);
    expect(hintMutate.mock.calls[0][0].idempotencyKey).toBe(
      hintMutate.mock.calls[1][0].idempotencyKey
    );
  });

  it("review 模式查看答案需二次确认，确认后显示解析", async () => {
    const user = userEvent.setup();
    exposureMutate.mockImplementation((_vars: unknown, opts: any) =>
      opts.onSuccess({
        ...fixtureAnswerExposure,
        feedback: {
          practiceItem: fixturePracticeItem({ options: undefined }),
          explanation: "答案是左根右。",
        },
      })
    );
    renderSession({ session: { ...fixtureSession, mode: "review" } });

    await user.click(screen.getByRole("button", { name: "查看答案" }));
    expect(
      screen.getByText("查看答案后，本题对掌握度的影响会降低")
    ).toBeInTheDocument();
    expect(exposureMutate).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "确认查看" }));
    expect(await screen.findByText("答案是左根右。")).toBeInTheDocument();
    expect(exposureMutate).toHaveBeenCalledTimes(1);
  });

  it("全部题目完成后显示完成态并可返回", async () => {
    const user = userEvent.setup();
    const onExit = vi.fn();
    submitMutate.mockImplementation((_vars: unknown, opts: any) =>
      opts.onSuccess(fixtureAttemptResult)
    );
    renderSession({
      session: { ...fixtureSession, items: [fixtureSession.items[0]] },
      onExit,
    });

    await user.click(screen.getByRole("radio", { name: "左根右" }));
    await user.click(screen.getByRole("button", { name: "提交答案" }));
    await user.click(await screen.findByRole("button", { name: "完成" }));

    expect(screen.getByText("本次练习完成")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "返回" }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("末题提交后的服务端 completed 更新不会抢走反馈", async () => {
    const user = userEvent.setup();
    submitMutate.mockImplementation((_vars: unknown, opts: any) =>
      opts.onSuccess(fixtureAttemptResult)
    );
    const oneItemSession = {
      ...fixtureSession,
      items: [fixtureSession.items[0]],
    };
    const view = renderSession({ session: oneItemSession });

    await user.click(screen.getByRole("radio", { name: "左根右" }));
    await user.click(screen.getByRole("button", { name: "提交答案" }));
    expect(await screen.findByText("回答错误")).toBeInTheDocument();

    view.rerender(
      <PracticeSession
        projectId="project-1"
        goalId="goal-1"
        session={{ ...oneItemSession, status: "completed" }}
      />
    );

    expect(screen.getByText("回答错误")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "完成" })).toBeInTheDocument();
  });

  it("session.status 为 completed 时直接显示完成态", () => {
    renderSession({ session: { ...fixtureSession, status: "completed" } });

    expect(screen.getByText("本次练习完成")).toBeInTheDocument();
  });
});
