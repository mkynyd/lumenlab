import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  evaluatePasswordStrength,
  PasswordStrength,
} from "@/components/auth/password-strength";

describe("PasswordStrength", () => {
  it("显示弱密码与未满足的建议", () => {
    render(<PasswordStrength password="abcdefgh" />);

    expect(screen.getByRole("meter", { name: "密码强度" })).toHaveAttribute(
      "aria-valuetext",
      "较弱"
    );
    expect(
      screen.getByRole("listitem", { name: "至少 8 个字符：已满足" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("listitem", {
        name: "同时包含字母和数字：未满足",
      })
    ).toBeInTheDocument();
  });

  it("将满足全部建议的密码评为强", () => {
    const result = evaluatePasswordStrength("LumenLab2026!");
    render(<PasswordStrength password="LumenLab2026!" />);

    expect(result.score).toBe(4);
    expect(screen.getByRole("meter", { name: "密码强度" })).toHaveAttribute(
      "aria-valuetext",
      "强"
    );
  });
});
