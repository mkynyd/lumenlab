import { describe, expect, it } from "vitest";
import {
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  sendMessageSchema,
  verifyCodeSchema,
  verifySendSchema,
} from "@/lib/validators";

describe("registerSchema", () => {
  it("requires the email verification ticket instead of a registration code", () => {
    expect(
      registerSchema.parse({
        email: "alpha@example.com",
        password: "password123",
        ticket: "challenge-1.rawToken",
      })
    ).toEqual({
      email: "alpha@example.com",
      password: "password123",
      ticket: "challenge-1.rawToken",
    });

    expect(() =>
      registerSchema.parse({
        email: "alpha@example.com",
        password: "password123",
      })
    ).toThrow();
  });

  it("preserves Unicode passwords without normalizing full-width symbols", () => {
    const password = "中文密码，符号！Aa1";

    expect(
      registerSchema.parse({
        email: "unicode@example.com",
        password,
        ticket: "challenge-1.rawToken",
      }).password
    ).toBe(password);
    expect(
      loginSchema.parse({ email: "unicode@example.com", password }).password
    ).toBe(password);
  });
});

describe("verifyCodeSchema", () => {
  it("accepts a six-digit code", () => {
    expect(
      verifyCodeSchema.parse({ email: "a@b.com", code: "123456" })
    ).toEqual({ email: "a@b.com", code: "123456" });
  });

  it("rejects a non-six-digit code", () => {
    expect(() =>
      verifyCodeSchema.parse({ email: "a@b.com", code: "12" })
    ).toThrow();
  });
});

describe("verifySendSchema", () => {
  it("normalizes the email", () => {
    expect(verifySendSchema.parse({ email: "  A@B.com " }).email).toBe("a@b.com");
  });
});

describe("resetPasswordSchema", () => {
  it("requires a ticket and a strong password", () => {
    expect(
      resetPasswordSchema.parse({ ticket: "challenge-1.raw", password: "new-password-123" })
    ).toEqual({ ticket: "challenge-1.raw", password: "new-password-123" });
  });

  it("rejects a short password", () => {
    expect(() =>
      resetPasswordSchema.parse({ ticket: "challenge-1.raw", password: "short" })
    ).toThrow();
  });
});

describe("sendMessageSchema", () => {
  it("defaults project chat requests to thinking mode", () => {
    expect(
      sendMessageSchema.parse({
        message: "总结资料",
        model: "deepseek-v4-pro",
      })
    ).toMatchObject({
      thinkingEnabled: true,
      reasoningEffort: "high",
    });
  });

  it("allows explicit MiniMax M3 selection", () => {
    expect(
      sendMessageSchema.parse({
        message: "分析图片资料",
        model: "minimax-m3",
      })
    ).toMatchObject({
      model: "minimax-m3",
      thinkingEnabled: true,
    });
  });

  it("rejects Qwen until its server-side rollout is enabled", () => {
    const previous = process.env.MODEL_QWEN_ENABLED;
    process.env.MODEL_QWEN_ENABLED = "false";
    try {
      expect(() => sendMessageSchema.parse({
        message: "分析视频内容",
        model: "qwen3.7-plus",
      })).toThrow("Qwen 模型暂未开放");
    } finally {
      if (previous === undefined) delete process.env.MODEL_QWEN_ENABLED;
      else process.env.MODEL_QWEN_ENABLED = previous;
    }
  });

  it("accepts Qwen after the rollout is enabled", () => {
    const previous = process.env.MODEL_QWEN_ENABLED;
    process.env.MODEL_QWEN_ENABLED = "true";
    try {
      expect(sendMessageSchema.parse({
        message: "分析图片内容",
        model: "qwen3.7-plus",
      })).toMatchObject({ model: "qwen3.7-plus" });
    } finally {
      if (previous === undefined) delete process.env.MODEL_QWEN_ENABLED;
      else process.env.MODEL_QWEN_ENABLED = previous;
    }
  });
});
