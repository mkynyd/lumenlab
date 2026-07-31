import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureReviewEntries } from "@/components/learning/__fixtures__/learning-fixtures";
import { ReviewQueue } from "@/components/learning/review-queue";

const router = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

const hooks = vi.hoisted(() => ({
  reviewQueue: {
    data: undefined as unknown,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  mutation: {
    mutate: vi.fn(),
    isPending: false,
    isError: false,
  },
}));

vi.mock("@/lib/hooks/use-learning-progress", () => ({
  useReviewQueue: () => hooks.reviewQueue,
  useCreateReviewSession: () => hooks.mutation,
}));

beforeEach(() => {
  router.push.mockReset();
  hooks.reviewQueue = {
    data: undefined,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  };
  hooks.mutation = { mutate: vi.fn(), isPending: false, isError: false };
});

describe("ReviewQueue", () => {
  it("lists due entries with mastery, freshness and a due hint", () => {
    hooks.reviewQueue.data = fixtureReviewEntries;
    render(<ReviewQueue projectId="project-1" goalId="goal-1" />);

    expect(screen.getByText("二叉树遍历")).toBeInTheDocument();
    expect(screen.getByText("图的遍历")).toBeInTheDocument();
    expect(screen.getByText("已掌握")).toBeInTheDocument();
    expect(screen.getByText("资料待更新")).toBeInTheDocument();
    expect(screen.getAllByText("到期")).toHaveLength(2);
  });

  it("renders no scheduled section since the server only returns due entries", () => {
    hooks.reviewQueue.data = fixtureReviewEntries;
    render(<ReviewQueue projectId="project-1" goalId="goal-1" />);

    expect(screen.queryByText(/已安排/)).not.toBeInTheDocument();
    expect(screen.queryByText("排序算法复杂度")).not.toBeInTheDocument();
  });

  it("shows a loading state while the queue is pending", () => {
    hooks.reviewQueue.isPending = true;
    render(<ReviewQueue projectId="project-1" goalId="goal-1" />);

    expect(screen.getByRole("status")).toHaveTextContent("加载中");
  });

  it("starts a review session and navigates to it on success", async () => {
    const user = userEvent.setup();
    hooks.reviewQueue.data = fixtureReviewEntries;
    hooks.mutation.mutate.mockImplementation(
      (variables: unknown, options: { onSuccess?: (data: unknown) => void }) =>
        options.onSuccess?.({ session: { id: "session-9" } })
    );
    render(<ReviewQueue projectId="project-1" goalId="goal-1" />);

    await user.click(screen.getByRole("button", { name: "开始复习" }));

    expect(hooks.mutation.mutate).toHaveBeenCalledWith(
      { limit: 10, idempotencyKey: expect.any(String) },
      expect.objectContaining({ onSuccess: expect.any(Function) })
    );
    expect(router.push).toHaveBeenCalledWith(
      "/projects/project-1/learning?session=session-9"
    );
  });

  it("disables the button and shows progress text while creating", () => {
    hooks.reviewQueue.data = fixtureReviewEntries;
    hooks.mutation.isPending = true;
    render(<ReviewQueue projectId="project-1" goalId="goal-1" />);

    expect(screen.getByRole("button", { name: "创建中…" })).toBeDisabled();
  });

  it("shows an inline error when session creation fails", () => {
    hooks.reviewQueue.data = fixtureReviewEntries;
    hooks.mutation.isError = true;
    render(<ReviewQueue projectId="project-1" goalId="goal-1" />);

    expect(screen.getByRole("alert")).toHaveTextContent("创建复习会话失败");
  });

  it("offers a retry button when the queue fails to load", async () => {
    const user = userEvent.setup();
    hooks.reviewQueue.isError = true;
    render(<ReviewQueue projectId="project-1" goalId="goal-1" />);

    expect(screen.getByText("复习队列加载失败")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(hooks.reviewQueue.refetch).toHaveBeenCalled();
  });

  it("shows the empty state when nothing is due", () => {
    hooks.reviewQueue.data = [];
    render(<ReviewQueue projectId="project-1" goalId="goal-1" />);

    expect(screen.getByText("暂时没有复习任务")).toBeInTheDocument();
  });
});
