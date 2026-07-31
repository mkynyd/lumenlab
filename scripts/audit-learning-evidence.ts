import { LEARNING_FRESHNESS_FIXTURES } from "../src/lib/agent/evals/fixtures/learning-freshness";
import {
  formatLearningFreshnessAudit,
  runLearningFreshnessEvals,
} from "../src/lib/agent/evals/learning-freshness-evaluator";

const report = runLearningFreshnessEvals(
  LEARNING_FRESHNESS_FIXTURES,
);

process.stdout.write(`${formatLearningFreshnessAudit(report)}\n`);
process.exitCode = report.failed === 0 ? 0 : 1;
