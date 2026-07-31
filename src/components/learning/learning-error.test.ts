import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api/client";
import { friendlyLearningError } from "@/components/learning/learning-error";

describe("friendlyLearningError", () => {
  it("passes through the learning API's localized server message", () => {
    const error = new ApiError("请求失败 (409)", 409, {
      error: { code: "invalid_state", message: "学习范围版本已变化，请刷新后重试" },
    });
    expect(friendlyLearningError(error)).toBe("学习范围版本已变化，请刷新后重试");
  });

  it("collapses bare status fallbacks to a friendly message", () => {
    const error = new ApiError("请求失败 (500)", 500, {
      error: { code: "invalid_state" },
    });
    expect(friendlyLearningError(error)).toBe(
      "网络异常或服务暂时不可用，请稍后重试。"
    );
  });

  it("never exposes raw browser network errors", () => {
    expect(friendlyLearningError(new TypeError("Failed to fetch"))).toBe(
      "网络异常或服务暂时不可用，请稍后重试。"
    );
  });

  it("handles non-Error values", () => {
    expect(friendlyLearningError(null)).toBe(
      "网络异常或服务暂时不可用，请稍后重试。"
    );
    expect(friendlyLearningError("boom")).toBe(
      "网络异常或服务暂时不可用，请稍后重试。"
    );
  });
});
