const EVALUATION_REASON_LABELS: Readonly<Record<string, string>> = {
  single_choice_answer_malformed: "无法识别本次选择，请重新作答",
  selected_option_matches: "所选答案与正确答案一致",
  selected_option_mismatch: "所选答案与正确答案不一致",
  multiple_choice_answer_malformed: "无法识别本次多选答案，请重新作答",
  selected_option_set_matches: "所选答案与正确答案一致",
  selected_option_set_partially_matches: "部分选项正确，但答案还不完整",
  selected_option_set_mismatch: "所选答案与正确答案不一致",
  boolean_answer_malformed: "无法识别本次判断，请重新作答",
  boolean_matches: "判断与正确答案一致",
  boolean_mismatch: "判断与正确答案不一致",
  numeric_answer_malformed: "无法识别本次数值，请重新作答",
  numeric_unit_mismatch: "数值单位与题目要求不一致",
  numeric_within_tolerance: "数值在允许误差范围内",
  numeric_outside_tolerance: "数值超出允许误差范围",
  structured_short_answer_malformed: "无法识别本次回答，请重新作答",
  required_keywords_present: "回答覆盖了关键要点",
  required_keywords_partially_present: "回答覆盖了部分关键要点",
  required_keywords_missing: "回答还没有覆盖关键要点",
  feedback_only_not_evidence: "本题仅提供反馈，不计入掌握度",
  rubric_requires_feedback: "本题需要进一步反馈后才能判定",
};

const INTERNAL_REASON_CODE = /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/;

/**
 * Graders persist stable machine-readable reason codes. Keep those codes in
 * APIs and audit history, but never expose them as learner-facing copy.
 * Model-written or otherwise human-readable reasons pass through unchanged.
 */
export function getEvaluationReasonLabel(reason: string): string {
  const normalized = reason.trim();
  const knownLabel = EVALUATION_REASON_LABELS[normalized];
  if (knownLabel) {
    return knownLabel;
  }
  if (INTERNAL_REASON_CODE.test(normalized)) {
    return "系统已根据评分规则完成判定";
  }
  return normalized;
}
