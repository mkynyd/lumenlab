import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/workbench/ambient-field", () => ({
  AmbientField: () => <div data-testid="ambient-field" />,
}));

import { AuthShowcase } from "@/components/auth/auth-showcase";

describe("AuthShowcase", () => {
  it("通过轮播控件切换产品介绍", async () => {
    const user = userEvent.setup();
    render(<AuthShowcase />);

    expect(
      screen.getByRole("heading", {
        name: "从资料出发，得到真正有上下文的回答",
      })
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "下一项产品介绍" }));

    expect(
      screen.getByRole("heading", {
        name: "把学习目标变成一条可执行的路径",
      })
    ).toBeInTheDocument();
    expect(screen.getByText("建立地图")).toBeInTheDocument();
  });
});
