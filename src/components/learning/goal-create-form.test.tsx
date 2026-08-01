import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";
import { GoalCreateForm } from "@/components/learning/goal-create-form";
import { useCreateLearningGoal } from "@/lib/hooks/use-learning-goals";
import { fixtureGoal } from "@/components/learning/__fixtures__/learning-fixtures";

vi.mock("@/lib/hooks/use-learning-goals", () => ({
  useCreateLearningGoal: vi.fn(),
}));

type CreateHookResult = ReturnType<typeof useCreateLearningGoal>;

function mockCreateGoal(overrides: Record<string, unknown> = {}) {
  const mutate = vi.fn();
  vi.mocked(useCreateLearningGoal).mockReturnValue({
    mutate,
    isPending: false,
    error: null,
    ...overrides,
  } as unknown as CreateHookResult);
  return mutate;
}

describe("GoalCreateForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("submits the filled fields, letting the hook default activate", async () => {
    const user = userEvent.setup();
    const mutate = mockCreateGoal();

    render(<GoalCreateForm projectId="project-1" />);

    await user.type(screen.getByLabelText("目标标题"), "数据结构期末冲刺");
    await user.type(screen.getByLabelText("用途"), "两周后考试");
    // shadcn Calendar 日期选择：打开弹出层并选中当月 14 号
    // （day 按钮的可访问名称是完整日期，如 "Friday, August 14th, 2026"）。
    await user.click(screen.getByLabelText("目标日期"));
    await user.click(screen.getByRole("button", { name: /14/ }));
    fireEvent.change(screen.getByLabelText("每天投入分钟"), {
      target: { value: "45" },
    });

    await user.click(screen.getByRole("button", { name: "创建学习目标" }));

    expect(mutate).toHaveBeenCalledTimes(1);
    const variables = mutate.mock.calls[0][0] as Record<string, unknown>;
    const now = new Date();
    const expectedTargetDate = `${now.getFullYear()}-${String(
      now.getMonth() + 1
    ).padStart(2, "0")}-14`;
    expect(variables).toEqual({
      title: "数据结构期末冲刺",
      purpose: "两周后考试",
      targetDate: expectedTargetDate,
      dailyMinutes: 45,
      idempotencyKey: expect.any(String),
    });
    // activate 不在 variables 中，由 hook 默认 true
    expect(variables).not.toHaveProperty("activate");
  });

  it("keeps the submit button disabled while the title is empty", async () => {
    const user = userEvent.setup();
    mockCreateGoal();

    render(<GoalCreateForm projectId="project-1" />);

    const submit = screen.getByRole("button", { name: "创建学习目标" });
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText("目标标题"), "操作系统");
    expect(submit).toBeEnabled();
  });

  it("reuses the same idempotency key across repeated submits", async () => {
    const user = userEvent.setup();
    const mutate = mockCreateGoal();

    render(<GoalCreateForm projectId="project-1" />);

    await user.type(screen.getByLabelText("目标标题"), "计算机网络");
    const submit = screen.getByRole("button", { name: "创建学习目标" });
    await user.click(submit);
    await user.click(submit);

    expect(mutate).toHaveBeenCalledTimes(2);
    const firstKey = (mutate.mock.calls[0][0] as { idempotencyKey: string }).idempotencyKey;
    const secondKey = (mutate.mock.calls[1][0] as { idempotencyKey: string }).idempotencyKey;
    expect(firstKey).toBe(secondKey);
  });

  it("issues a new idempotency key when fields change after a failed submit", async () => {
    const user = userEvent.setup();
    const mutate = mockCreateGoal();

    render(<GoalCreateForm projectId="project-1" />);

    const titleInput = screen.getByLabelText("目标标题");
    await user.type(titleInput, "计算机网络");
    const submit = screen.getByRole("button", { name: "创建学习目标" });
    await user.click(submit);

    await user.clear(titleInput);
    await user.type(titleInput, "操作系统");
    await user.click(submit);

    expect(mutate).toHaveBeenCalledTimes(2);
    const firstKey = (mutate.mock.calls[0][0] as { idempotencyKey: string }).idempotencyKey;
    const secondKey = (mutate.mock.calls[1][0] as { idempotencyKey: string }).idempotencyKey;
    expect(firstKey).not.toBe(secondKey);
  });

  it("shows the api error message inline", () => {
    mockCreateGoal({ error: new ApiError("目标标题已存在", 409, null) });

    render(<GoalCreateForm projectId="project-1" />);

    expect(screen.getByRole("alert")).toHaveTextContent("目标标题已存在");
  });

  it("clears the form and calls onCreated on success", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    const mutate = vi.fn(
      (_variables: unknown, options?: { onSuccess?: (data: { goal: typeof fixtureGoal }) => void }) => {
        options?.onSuccess?.({ goal: fixtureGoal });
      }
    );
    mockCreateGoal({ mutate });

    render(<GoalCreateForm projectId="project-1" onCreated={onCreated} />);

    const titleInput = screen.getByLabelText("目标标题");
    await user.type(titleInput, "数据结构期末复习");
    await user.click(screen.getByRole("button", { name: "创建学习目标" }));

    expect(onCreated).toHaveBeenCalledWith(fixtureGoal);
    expect(titleInput).toHaveValue("");
  });

  it("disables submit and shows the pending label while creating", () => {
    mockCreateGoal({ isPending: true });

    render(<GoalCreateForm projectId="project-1" />);

    const submit = screen.getByRole("button", { name: "创建中…" });
    expect(submit).toBeDisabled();
  });
});
