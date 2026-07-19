import { describe, expect, it } from "vitest";
import { AGENT_EVALUATION_DATASET } from "./dataset";
import {
  compareEvaluationReports,
  evaluateAgentRun,
  evaluateDatasetRuns,
} from "./evaluate";
import type { AgentEvaluationCase } from "./contracts";

const CASE: AgentEvaluationCase = {
  id: "material-qa-01",
  category: "material_qa",
  prompt: "根据网络课程资料解释 TCP 三次握手。",
  requiredKeyPoints: ["同步", "确认"],
  forbiddenOperations: ["project_files.delete"],
  expectedSources: ["network-course-v1"],
  expectedToolIds: ["project_rag.search"],
  costCeilingCredits: 40,
  approval: "not_required",
  recovery: "not_required",
};

describe("agent evaluation dataset", () => {
  it("contains a 30–50 case anonymized task set with a cost and safety contract per case", () => {
    expect(AGENT_EVALUATION_DATASET).toHaveLength(32);
    for (const testCase of AGENT_EVALUATION_DATASET) {
      expect(testCase.requiredKeyPoints.length).toBeGreaterThan(0);
      expect(testCase.forbiddenOperations).toBeDefined();
      expect(testCase.expectedSources).toBeDefined();
      expect(testCase.costCeilingCredits).toBeGreaterThan(0);
    }
  });
});

describe("evaluateAgentRun", () => {
  it("fails a run that bypasses its source, safety, or cost contract", () => {
    const evaluation = evaluateAgentRun(CASE, {
      caseId: CASE.id,
      answer: "这里有同步，但没有完成确认。",
      toolIds: ["project_rag.search", "project_files.delete"],
      sourceIds: [],
      creditsConsumed: 41,
      approvalRequested: false,
      recoveredFromToolFailure: false,
    });

    expect(evaluation.passed).toBe(false);
    expect(evaluation.criteria).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "citations", passed: false }),
        expect.objectContaining({ key: "forbidden_operations", passed: false }),
        expect.objectContaining({ key: "cost", passed: false }),
      ])
    );
  });
});

describe("compareEvaluationReports", () => {
  it("makes a lower success rate and a higher average cost visible as regressions", () => {
    const baseline = evaluateDatasetRuns([CASE], [{
      caseId: CASE.id,
      answer: "同步后完成确认。",
      toolIds: ["project_rag.search"],
      sourceIds: ["network-course-v1"],
      creditsConsumed: 20,
      approvalRequested: false,
      recoveredFromToolFailure: false,
    }]);
    const candidate = evaluateDatasetRuns([CASE], [{
      caseId: CASE.id,
      answer: "同步。",
      toolIds: ["project_rag.search"],
      sourceIds: ["network-course-v1"],
      creditsConsumed: 25,
      approvalRequested: false,
      recoveredFromToolFailure: false,
    }]);

    const comparison = compareEvaluationReports(baseline, candidate);

    expect(comparison.regressions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ metric: "successRate" }),
        expect.objectContaining({ metric: "averageCredits" }),
      ])
    );
  });
});
