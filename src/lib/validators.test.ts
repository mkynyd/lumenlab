import { describe, expect, it } from "vitest";
import { registerSchema, sendMessageSchema } from "@/lib/validators";

describe("registerSchema", () => {
  it("requires a registration code", () => {
    expect(
      registerSchema.parse({
        email: "alpha@example.com",
        password: "password123",
        registrationCode: "ALPHA-7X9P",
      })
    ).toEqual({
      email: "alpha@example.com",
      password: "password123",
      registrationCode: "ALPHA-7X9P",
    });

    expect(() =>
      registerSchema.parse({
        email: "alpha@example.com",
        password: "password123",
      })
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
