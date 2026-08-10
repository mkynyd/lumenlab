import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PasswordInput } from "@/components/ui/password-input";

describe("PasswordInput", () => {
  it("keeps the value while toggling into text mode for IME input", async () => {
    const user = userEvent.setup();
    render(<PasswordInput aria-label="密码" />);

    const input = screen.getByLabelText("密码");
    expect(input).toHaveAttribute("type", "password");

    await user.type(input, "中文，符号！Aa1");
    await user.click(
      screen.getByRole("button", { name: "显示密码并允许使用中文输入法" })
    );

    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveValue("中文，符号！Aa1");

    await user.click(screen.getByRole("button", { name: "隐藏密码" }));
    expect(input).toHaveAttribute("type", "password");
    expect(input).toHaveValue("中文，符号！Aa1");
  });
});
