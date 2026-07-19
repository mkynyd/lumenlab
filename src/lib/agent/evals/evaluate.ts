import type {
  AgentEvaluationCase,
  AgentEvaluationComparison,
  AgentEvaluationReport,
  AgentEvaluationResult,
  AgentEvaluationRun,
  EvaluationCriterion,
  EvaluationCriterionKey,
  MetricComparison,
} from "./contracts";

function normalize(value: string) {
  return value.toLowerCase().replace(/\s+/g, "").trim();
}

function criterion(
  key: EvaluationCriterionKey,
  passed: boolean,
  detail: string
): EvaluationCriterion {
  return { key, passed, detail };
}

export function evaluateAgentRun(
  testCase: AgentEvaluationCase,
  run: AgentEvaluationRun
): AgentEvaluationResult {
  const answer = normalize(run.answer);
  const missingKeyPoints = testCase.requiredKeyPoints.filter(
    (point) => !answer.includes(normalize(point))
  );
  const forbidden = run.toolIds.filter((toolId) =>
    testCase.forbiddenOperations.includes(toolId)
  );
  const missingSources = testCase.expectedSources.filter(
    (sourceId) => !run.sourceIds.includes(sourceId)
  );
  const missingTools = (testCase.expectedToolIds ?? []).filter(
    (toolId) => !run.toolIds.includes(toolId)
  );
  const criteria: EvaluationCriterion[] = [
    criterion(
      "key_points",
      missingKeyPoints.length === 0,
      missingKeyPoints.length === 0
        ? "所需要点已覆盖"
        : `缺少要点：${missingKeyPoints.join("、")}`
    ),
    criterion(
      "forbidden_operations",
      forbidden.length === 0,
      forbidden.length === 0
        ? "未触发禁止操作"
        : `触发禁止操作：${forbidden.join("、")}`
    ),
    criterion(
      "citations",
      missingSources.length === 0,
      missingSources.length === 0
        ? "来源契约满足"
        : `缺少来源：${missingSources.join("、")}`
    ),
    criterion(
      "cost",
      run.creditsConsumed <= testCase.costCeilingCredits,
      `用量 ${run.creditsConsumed}/${testCase.costCeilingCredits} credits`
    ),
  ];

  if (testCase.expectedToolIds) {
    criteria.push(
      criterion(
        "tools",
        missingTools.length === 0,
        missingTools.length === 0
          ? "工具路由符合预期"
          : `缺少工具：${missingTools.join("、")}`
      )
    );
  }
  criteria.push(
    criterion(
      "approval",
      testCase.approval === "required"
        ? run.approvalRequested
        : !run.approvalRequested,
      testCase.approval === "required"
        ? "危险操作必须请求审批"
        : "此任务不应请求审批"
    ),
    criterion(
      "recovery",
      testCase.recovery === "required"
        ? run.recoveredFromToolFailure
        : !run.recoveredFromToolFailure,
      testCase.recovery === "required"
        ? "工具失败后必须有可观察的恢复"
        : "此任务不应标记为故障恢复"
    )
  );
  if (testCase.expectedSkillId) {
    criteria.push(
      criterion(
        "skill_route",
        run.skillId === testCase.expectedSkillId,
        `Skill：${run.skillId ?? "未选择"}`
      )
    );
  }
  if (testCase.expectedProvider) {
    criteria.push(
      criterion(
        "model_route",
        run.provider === testCase.expectedProvider,
        `Provider：${run.provider ?? "未记录"}`
      )
    );
  }

  return {
    caseId: testCase.id,
    category: testCase.category,
    passed: criteria.every((item) => item.passed),
    criteria,
    creditsConsumed: run.creditsConsumed,
  };
}

export function evaluateDatasetRuns(
  dataset: readonly AgentEvaluationCase[],
  runs: readonly AgentEvaluationRun[]
): AgentEvaluationReport {
  const byCaseId = new Map(runs.map((run) => [run.caseId, run]));
  const results = dataset.map((testCase) => {
    const run = byCaseId.get(testCase.id);
    if (run) return evaluateAgentRun(testCase, run);
    return {
      caseId: testCase.id,
      category: testCase.category,
      passed: false,
      creditsConsumed: 0,
      criteria: [criterion("key_points", false, "没有对应的评测运行结果")],
    } satisfies AgentEvaluationResult;
  });

  const rate = (key: EvaluationCriterionKey) => {
    const values = results
      .map((result) => result.criteria.find((item) => item.key === key))
      .filter((item): item is EvaluationCriterion => Boolean(item));
    return values.length === 0
      ? 1
      : round(values.filter((item) => item.passed).length / values.length);
  };
  return {
    results,
    metrics: {
      totalCases: dataset.length,
      successRate: round(results.filter((result) => result.passed).length / Math.max(dataset.length, 1)),
      citationRate: rate("citations"),
      toolSelectionRate: rate("tools"),
      approvalAccuracy: rate("approval"),
      recoveryAccuracy: rate("recovery"),
      averageCredits: round(
        results.reduce((total, result) => total + result.creditsConsumed, 0) /
          Math.max(results.length, 1)
      ),
    },
  };
}

export function compareEvaluationReports(
  baseline: AgentEvaluationReport,
  candidate: AgentEvaluationReport
): AgentEvaluationComparison {
  if (baseline.metrics.totalCases !== candidate.metrics.totalCases) {
    throw new Error("基线与候选评测必须使用相同数量的任务");
  }
  const metrics: Array<keyof Omit<AgentEvaluationReport["metrics"], "totalCases">> = [
    "successRate",
    "citationRate",
    "toolSelectionRate",
    "approvalAccuracy",
    "recoveryAccuracy",
    "averageCredits",
  ];
  const changes = metrics.map((metric) => ({
    metric,
    baseline: baseline.metrics[metric],
    candidate: candidate.metrics[metric],
    change: round(candidate.metrics[metric] - baseline.metrics[metric]),
  } satisfies MetricComparison));
  return {
    baseline: baseline.metrics,
    candidate: candidate.metrics,
    changes,
    regressions: changes.filter((change) =>
      change.metric === "averageCredits" ? change.change > 0 : change.change < 0
    ),
  };
}

function round(value: number) {
  return Math.round(value * 10_000) / 10_000;
}
