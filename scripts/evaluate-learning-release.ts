/**
 * Learning P1 release gate runner.
 *
 * Deterministic by default: runs the frozen release gates, compares against
 * the committed baseline (reports/learning-release-baseline.json) and exits
 * non-zero on any regression so the release is blocked.
 *
 * Real-provider evaluation is a separate manual workflow:
 *   npm run eval:learning -- --provider deepseek --userId <user-id>
 * It calls the DeepSeek learning gateway with fixed-course fixtures and gates
 * the output contract (schema, source handles). Never runs in CI.
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createDeepSeekLearningModelGateway } from "../src/lib/learning/model-gateway";
import {
  compareReleaseGates,
  runLearningReleaseGates,
  type ReleaseGateReport,
  type ReleaseRunManifest,
} from "../src/lib/learning/evals/p1/release-gates";
import {
  knowledgeMapGenerationSchema,
  practiceItemGenerationSchema,
} from "../src/lib/learning/validators";

const REPORTS_DIR = join(__dirname, "..", "reports");
const BASELINE_PATH = join(REPORTS_DIR, "learning-release-baseline.json");

interface CliArgs {
  updateBaseline: boolean;
  json: boolean;
  provider?: string;
  userId?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { updateBaseline: false, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--update-baseline") args.updateBaseline = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--provider") args.provider = argv[++i];
    else if (arg === "--userId") args.userId = argv[++i];
  }
  return args;
}

function resolveCommitSha(): string | undefined {
  try {
    return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return undefined;
  }
}

function resolveEnvironment(): ReleaseRunManifest["environment"] {
  if (process.env.CI) return "ci";
  return "local";
}

function printReport(report: ReleaseGateReport, comparisonLabel: string): void {
  console.log(`\n学习发布门禁（${report.manifest.environment} · ${report.manifest.model}）`);
  console.log(
    `结果：${report.summary.passed}/${report.summary.total} 通过，` +
      `失败 ${report.summary.failed}；对比 ${comparisonLabel}`,
  );
  console.log("\n按门禁聚合：");
  for (const [gate, bucket] of Object.entries(report.byGate)) {
    console.log(`  ${gate.padEnd(18)} ${bucket.passed}/${bucket.total}`);
  }
  console.log("\n按条目类型聚合：");
  for (const [itemType, bucket] of Object.entries(report.byItemType)) {
    console.log(`  ${itemType.padEnd(18)} ${bucket.passed}/${bucket.total}`);
  }
  console.log("\n按失败阶段聚合：");
  for (const [stage, bucket] of Object.entries(report.byFailureStage)) {
    console.log(`  ${stage.padEnd(18)} ${bucket.passed}/${bucket.total}`);
  }
  const failures = report.results.filter((result) => !result.passed);
  if (failures.length > 0) {
    console.log("\n失败用例：");
    for (const failure of failures) {
      console.log(`  [${failure.gate}] ${failure.id}: ${failure.detail ?? "failed"}`);
    }
  }
}

/**
 * Real-provider workflow: fixed-course fixtures through the DeepSeek learning
 * gateway. Requires the user's DeepSeek key (USER_API_KEYS_ENABLED flow) and
 * is only ever triggered manually — never by CI.
 */
async function runProviderEvaluation(
  provider: string,
  userId: string,
  commitSha?: string,
): Promise<ReleaseGateReport> {
  const gateway = createDeepSeekLearningModelGateway();
  const content =
    "基尔霍夫电流定律：流入节点的电流等于流出节点的电流。\n" +
    "基尔霍夫电压定律：沿闭合回路电压代数和为零。\n" +
    "叠加定理：线性电路中多电源共同作用等于各电源单独作用之和。";
  const fixtureSources = [
    {
      handle: "fixture-circuit-1",
      fileAssetId: "fixture-file-1",
      title: "电路原理.md",
      content,
      contentFingerprint: "sha256:v1:fixture-circuit-v1",
    },
  ];
  const goal = {
    id: "fixture-goal-1",
    title: "电路基础",
    purpose: "期末考试复习",
    targetDate: "2026-08-15T00:00:00.000Z",
  };
  const scope = {
    id: "fixture-scope-1",
    version: 1,
    status: "confirmed",
    materialMode: "selected_files",
    fileIds: ["fixture-file-1"],
    materialGaps: [],
  };

  const mapInput = {
    userId,
    goal,
    scope,
    sources: fixtureSources,
  };
  const mapOutput = knowledgeMapGenerationSchema.parse(
    await gateway.generateKnowledgeMap(mapInput),
  );
  const handles = new Set(fixtureSources.map((source) => source.handle));
  const invalidHandles = mapOutput.points.flatMap((point) =>
    point.sourceHandles.filter((handle) => !handles.has(handle)),
  );
  if (invalidHandles.length > 0) {
    throw new Error(
      `provider map referenced unknown source handles: ${[...new Set(invalidHandles)].join(", ")}`,
    );
  }

  const itemsOutput = practiceItemGenerationSchema.array().min(5).max(10).parse(
    await gateway.generatePracticeItems({
      userId,
      map: {
        id: "fixture-map-1",
        goalId: "fixture-goal-1",
        version: 1,
        points: mapOutput.points,
      },
      sources: fixtureSources,
    }),
  );
  const invalidItemHandles = itemsOutput.flatMap((item) =>
    item.sourceHandles.filter((handle) => !handles.has(handle)),
  );
  if (invalidItemHandles.length > 0) {
    throw new Error(
      `provider items referenced unknown source handles: ${[...new Set(invalidItemHandles)].join(", ")}`,
    );
  }

  // Provider success is reported as a pass of the two contract gates; any
  // schema/handle failure above rejects the run instead.
  return runLearningReleaseGates({
    environment: "manual-provider",
    model: `${provider}-deepseek-v4-flash`,
    commitSha,
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const commitSha = resolveCommitSha();
  const environment = resolveEnvironment();

  let report: ReleaseGateReport;
  if (args.provider) {
    if (!args.userId) {
      console.error("--provider 需要 --userId（真实 Provider 只由手动 workflow 触发）");
      process.exit(2);
    }
    report = await runProviderEvaluation(args.provider, args.userId, commitSha);
  } else {
    report = runLearningReleaseGates({ environment, commitSha });
  }

  const baseline: ReleaseGateReport | null = existsSync(BASELINE_PATH)
    ? (JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as ReleaseGateReport)
    : null;

  if (args.updateBaseline) {
    mkdirSync(REPORTS_DIR, { recursive: true });
    writeFileSync(BASELINE_PATH, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`\n已更新基线：${BASELINE_PATH}`);
    printReport(report, "新基线（无对比）");
    process.exit(0);
  }

  if (!baseline) {
    console.error(
      "缺少基线 reports/learning-release-baseline.json，先运行 npm run eval:learning -- --update-baseline",
    );
    printReport(report, "无基线（未对比）");
    process.exit(2);
  }

  const comparison = compareReleaseGates(baseline, report);
  printReport(report, `基线（${baseline.manifest.ranAt}）`);
  if (comparison.regressions.length > 0) {
    console.error("\n发布被阻止：以下门禁从基线通过变为失败：");
    for (const regression of comparison.regressions) {
      console.error(
        `  [${regression.gate}] ${regression.id}（${regression.itemType}）：${regression.detail ?? "failed"}`,
      );
    }
    process.exit(1);
  }
  console.log(
    `\n无回归（${comparison.stable} 项保持，${comparison.improvements.length} 项改善），可以发布。`,
  );
  process.exit(0);
}

main().catch((error) => {
  console.error("学习发布门禁执行失败：", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
