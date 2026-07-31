import type {
  AnswerCriteriaDto,
  EvaluationVerdict,
  PracticeMode,
} from "../contracts";

export type FrozenAttemptEvaluation = Readonly<{
  verdict: EvaluationVerdict;
  score: number | null;
  rubric: Record<string, unknown> | null;
  confidence: number;
  errorType: string | null;
  reason: string;
}>;

export type GradeAttemptInput = Readonly<{
  mode: PracticeMode;
  answer: unknown;
  criteria: AnswerCriteriaDto;
}>;

type EvaluationFields = {
  verdict: EvaluationVerdict;
  score: number | null;
  rubric?: Record<string, unknown> | null;
  confidence?: number;
  errorType?: string | null;
  reason: string;
};

const freezeEvaluation = ({
  verdict,
  score,
  rubric = null,
  confidence = 1,
  errorType = null,
  reason,
}: EvaluationFields): FrozenAttemptEvaluation =>
  Object.freeze({
    verdict,
    score,
    rubric,
    confidence,
    errorType,
    reason,
  });

const correct = (reason: string): FrozenAttemptEvaluation =>
  freezeEvaluation({ verdict: "correct", score: 1, reason });

const partial = (score: number, reason: string): FrozenAttemptEvaluation =>
  freezeEvaluation({
    verdict: "partial",
    score,
    errorType: "knowledge_gap",
    reason,
  });

const incorrect = (
  reason: string,
  errorType = "knowledge_gap",
): FrozenAttemptEvaluation =>
  freezeEvaluation({
    verdict: "incorrect",
    score: 0,
    errorType,
    reason,
  });

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function extractStringField(
  answer: unknown,
  field: string,
): string | null {
  if (typeof answer === "string") {
    return answer;
  }
  const record = asRecord(answer);
  const value = record?.[field];
  return typeof value === "string" ? value : null;
}

function gradeSingleChoice(
  criteria: Extract<AnswerCriteriaDto, { kind: "single_choice" }>,
  answer: unknown,
): FrozenAttemptEvaluation {
  const selectedOptionId = extractStringField(answer, "selectedOptionId");
  if (selectedOptionId === null) {
    return incorrect("single_choice_answer_malformed", "reading_or_time");
  }
  return selectedOptionId === criteria.selectedOptionId
    ? correct("selected_option_matches")
    : incorrect("selected_option_mismatch");
}

function extractSelectedOptionIds(answer: unknown): string[] | null {
  const raw = Array.isArray(answer)
    ? answer
    : asRecord(answer)?.selectedOptionIds;
  if (
    !Array.isArray(raw) ||
    !raw.every((optionId) => typeof optionId === "string")
  ) {
    return null;
  }
  return raw;
}

function gradeMultipleChoice(
  criteria: Extract<AnswerCriteriaDto, { kind: "multiple_choice" }>,
  answer: unknown,
): FrozenAttemptEvaluation {
  const selected = extractSelectedOptionIds(answer);
  if (selected === null || new Set(selected).size !== selected.length) {
    return incorrect("multiple_choice_answer_malformed", "reading_or_time");
  }

  const required = new Set(criteria.requiredOptionIds);
  const chosen = new Set(selected);
  const matches = [...chosen].filter((optionId) =>
    required.has(optionId),
  ).length;
  const hasUnexpected = [...chosen].some((optionId) => !required.has(optionId));

  if (!hasUnexpected && chosen.size === required.size && matches === required.size) {
    return correct("selected_option_set_matches");
  }
  if (matches > 0) {
    const denominator = Math.max(required.size, chosen.size);
    return partial(
      denominator === 0 ? 0 : matches / denominator,
      "selected_option_set_partially_matches",
    );
  }
  return incorrect("selected_option_set_mismatch");
}

function parseBoolean(answer: unknown): boolean | null {
  const value =
    typeof answer === "object" && answer !== null && !Array.isArray(answer)
      ? (answer as Record<string, unknown>).value
      : answer;
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.normalize("NFKC").trim().toLowerCase();
  if (["true", "正确", "是", "对"].includes(normalized)) {
    return true;
  }
  if (["false", "错误", "否", "错"].includes(normalized)) {
    return false;
  }
  return null;
}

function gradeBoolean(
  criteria: Extract<AnswerCriteriaDto, { kind: "boolean" }>,
  answer: unknown,
): FrozenAttemptEvaluation {
  const parsed = parseBoolean(answer);
  if (parsed === null) {
    return incorrect("boolean_answer_malformed", "reading_or_time");
  }
  return parsed === criteria.expected
    ? correct("boolean_matches")
    : incorrect("boolean_mismatch");
}

type ParsedNumericAnswer = {
  value: number;
  unit: string | null;
};

function normalizeUnit(unit: string): string {
  return unit.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
}

function parseNumericAnswer(answer: unknown): ParsedNumericAnswer | null {
  if (typeof answer === "number") {
    return Number.isFinite(answer) ? { value: answer, unit: null } : null;
  }

  const record = asRecord(answer);
  if (record) {
    const value = record.value;
    const unit = record.unit;
    if (
      typeof value === "number" &&
      Number.isFinite(value) &&
      (unit === undefined || typeof unit === "string")
    ) {
      return { value, unit: typeof unit === "string" ? unit : null };
    }
  }

  if (typeof answer !== "string") {
    return null;
  }
  const match = answer
    .normalize("NFKC")
    .trim()
    .match(
      /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*([^\d\s].*)?$/i,
    );
  if (!match) {
    return null;
  }
  const value = Number(match[1]);
  return Number.isFinite(value)
    ? { value, unit: match[2]?.trim() || null }
    : null;
}

function gradeNumeric(
  criteria: Extract<AnswerCriteriaDto, { kind: "numeric" }>,
  answer: unknown,
): FrozenAttemptEvaluation {
  const parsed = parseNumericAnswer(answer);
  if (parsed === null) {
    return incorrect("numeric_answer_malformed", "reading_or_time");
  }

  if (criteria.unit) {
    if (
      parsed.unit === null ||
      normalizeUnit(parsed.unit) !== normalizeUnit(criteria.unit)
    ) {
      return incorrect("numeric_unit_mismatch", "calculation_or_operation");
    }
  }

  const difference = Math.abs(parsed.value - criteria.expected);
  return difference <= criteria.absoluteTolerance + Number.EPSILON
    ? correct("numeric_within_tolerance")
    : incorrect("numeric_outside_tolerance", "calculation_or_operation");
}

function normalizeText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function gradeKeywords(
  criteria: Extract<AnswerCriteriaDto, { kind: "keywords" }>,
  answer: unknown,
): FrozenAttemptEvaluation {
  const text = extractStringField(answer, "text");
  if (text === null) {
    return incorrect("structured_short_answer_malformed", "reading_or_time");
  }

  const normalized = normalizeText(text);
  const matchedRequired = criteria.required.filter((keyword) =>
    normalized.includes(normalizeText(keyword)),
  ).length;
  if (matchedRequired === criteria.required.length) {
    return correct("required_keywords_present");
  }
  if (matchedRequired > 0) {
    return partial(
      matchedRequired / criteria.required.length,
      "required_keywords_partially_present",
    );
  }
  return incorrect("required_keywords_missing");
}

/**
 * Deterministic grading for closed and structured-short practice items.
 *
 * Rubric/open work is deliberately not auto-promoted to evidence. Its
 * evaluator may provide feedback elsewhere, but this frozen result remains
 * uncertain until an explicit, trusted grading policy is introduced.
 */
export function gradeAttempt({
  mode,
  answer,
  criteria,
}: GradeAttemptInput): FrozenAttemptEvaluation {
  if (mode === "feedback_only") {
    return freezeEvaluation({
      verdict: "uncertain",
      score: null,
      reason: "feedback_only_not_evidence",
    });
  }

  switch (criteria.kind) {
    case "single_choice":
      return gradeSingleChoice(criteria, answer);
    case "multiple_choice":
      return gradeMultipleChoice(criteria, answer);
    case "boolean":
      return gradeBoolean(criteria, answer);
    case "numeric":
      return gradeNumeric(criteria, answer);
    case "keywords":
      return gradeKeywords(criteria, answer);
    case "rubric":
      return freezeEvaluation({
        verdict: "uncertain",
        score: null,
        reason: "rubric_requires_feedback",
      });
  }
}
