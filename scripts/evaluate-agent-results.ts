import { readFileSync } from "node:fs";
import { AGENT_EVALUATION_DATASET } from "../src/lib/agent/evals/dataset";
import {
  compareEvaluationReports,
  evaluateDatasetRuns,
} from "../src/lib/agent/evals/evaluate";
import type { AgentEvaluationRun } from "../src/lib/agent/evals/contracts";

type Arguments = {
  validateDataset: boolean;
  results?: string;
  baseline?: string;
  candidate?: string;
};

function readArguments(argv: string[]): Arguments {
  const args: Arguments = { validateDataset: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--validate-dataset") args.validateDataset = true;
    if (token === "--results") args.results = argv[index + 1];
    if (token === "--baseline") args.baseline = argv[index + 1];
    if (token === "--candidate") args.candidate = argv[index + 1];
  }
  return args;
}

function loadRuns(path: string): AgentEvaluationRun[] {
  const body = readFileSync(path, "utf8").trim();
  if (!body) return [];
  const parsed = body.startsWith("[")
    ? JSON.parse(body)
    : body.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  if (!Array.isArray(parsed)) throw new Error("评测结果必须是 JSON 数组或 JSONL");
  const runs = parsed.map((entry, index) => validateRun(entry, index));
  const expectedIds = new Set(AGENT_EVALUATION_DATASET.map((testCase) => testCase.id));
  const seenIds = new Set<string>();
  for (const run of runs) {
    if (!expectedIds.has(run.caseId)) throw new Error(`未知评测 ID：${run.caseId}`);
    if (seenIds.has(run.caseId)) throw new Error(`重复的评测 ID：${run.caseId}`);
    seenIds.add(run.caseId);
  }
  if (seenIds.size !== expectedIds.size) {
    throw new Error("评测结果必须覆盖固定任务集中的全部用例");
  }
  return runs;
}

function validateRun(value: unknown, index: number): AgentEvaluationRun {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`第 ${index + 1} 条评测结果不是对象`);
  }
  const input = value as Record<string, unknown>;
  const strings = (key: string) => {
    const value = input[key];
    if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
      throw new Error(`第 ${index + 1} 条评测结果的 ${key} 无效`);
    }
    return value as string[];
  };
  if (
    typeof input.caseId !== "string" ||
    typeof input.answer !== "string" ||
    typeof input.creditsConsumed !== "number" ||
    !Number.isFinite(input.creditsConsumed) ||
    input.creditsConsumed < 0 ||
    typeof input.approvalRequested !== "boolean" ||
    typeof input.recoveredFromToolFailure !== "boolean"
  ) {
    throw new Error(`第 ${index + 1} 条评测结果缺少必填字段`);
  }
  return {
    caseId: input.caseId,
    answer: input.answer,
    toolIds: strings("toolIds"),
    sourceIds: strings("sourceIds"),
    creditsConsumed: input.creditsConsumed,
    approvalRequested: input.approvalRequested,
    recoveredFromToolFailure: input.recoveredFromToolFailure,
    ...(typeof input.skillId === "string" ? { skillId: input.skillId } : {}),
    ...(input.provider === "deepseek" || input.provider === "minimax" || input.provider === "bailian"
      ? { provider: input.provider }
      : {}),
  };
}

function validateDataset() {
  if (AGENT_EVALUATION_DATASET.length < 30 || AGENT_EVALUATION_DATASET.length > 50) {
    throw new Error("评测集必须包含 30–50 条任务");
  }
  const ids = new Set<string>();
  for (const testCase of AGENT_EVALUATION_DATASET) {
    if (ids.has(testCase.id)) throw new Error(`重复的评测 ID：${testCase.id}`);
    ids.add(testCase.id);
    if (
      testCase.requiredKeyPoints.length === 0 ||
      testCase.forbiddenOperations.length === 0 ||
      testCase.costCeilingCredits <= 0
    ) {
      throw new Error(`评测用例 ${testCase.id} 缺少验收契约`);
    }
  }
}

function main() {
  const args = readArguments(process.argv.slice(2));
  validateDataset();
  if (args.validateDataset && !args.results && !args.baseline && !args.candidate) {
    console.log(JSON.stringify({ valid: true, cases: AGENT_EVALUATION_DATASET.length }));
    return;
  }
  if (args.results && !args.baseline && !args.candidate) {
    console.log(JSON.stringify(evaluateDatasetRuns(AGENT_EVALUATION_DATASET, loadRuns(args.results)), null, 2));
    return;
  }
  if (args.baseline && args.candidate && !args.results) {
    const baseline = evaluateDatasetRuns(AGENT_EVALUATION_DATASET, loadRuns(args.baseline));
    const candidate = evaluateDatasetRuns(AGENT_EVALUATION_DATASET, loadRuns(args.candidate));
    console.log(JSON.stringify(compareEvaluationReports(baseline, candidate), null, 2));
    return;
  }
  throw new Error("用法：--validate-dataset | --results <file> | --baseline <file> --candidate <file>");
}

main();
