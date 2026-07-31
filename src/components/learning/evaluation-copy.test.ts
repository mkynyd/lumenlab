import { describe, expect, it } from "vitest";

import { getEvaluationReasonLabel } from "@/components/learning/evaluation-copy";

describe("getEvaluationReasonLabel", () => {
  it("maps known grader reason codes to learner-facing copy", () => {
    expect(getEvaluationReasonLabel("selected_option_matches")).toBe(
      "所选答案与正确答案一致"
    );
    expect(getEvaluationReasonLabel("boolean_mismatch")).toBe(
      "判断与正确答案不一致"
    );
  });

  it("masks unknown snake_case internal codes", () => {
    expect(getEvaluationReasonLabel("brand_new_reason_code")).toBe(
      "系统已根据评分规则完成判定"
    );
  });

  it("masks single-word internal codes", () => {
    expect(getEvaluationReasonLabel("correct")).toBe(
      "系统已根据评分规则完成判定"
    );
  });

  it("passes human-readable Chinese reasons through", () => {
    expect(getEvaluationReasonLabel("中序遍历先访问左子树，再访问根。")).toBe(
      "中序遍历先访问左子树，再访问根。"
    );
  });

  it("passes human-readable sentence-style reasons through", () => {
    expect(
      getEvaluationReasonLabel("The traversal order is left-root-right.")
    ).toBe("The traversal order is left-root-right.");
  });
});
