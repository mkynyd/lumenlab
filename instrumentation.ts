import { logger } from "@/lib/logger";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  try {
    const { startParseJobWorker } = await import("@/lib/document-pipeline/job-runner");
    const result = await startParseJobWorker();
    logger.info("Parse job worker started", result);
  } catch (error) {
    logger.error("Failed to start parse job worker", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (process.env.AGENT_DURABLE_EXECUTION_ENABLED === "true") {
    try {
      const { startAgentExecutionWorker } = await import(
        "@/lib/agent/executions/durable-agent-runtime"
      );
      const result = startAgentExecutionWorker();
      logger.info("Agent execution worker ready", result);
    } catch (error) {
      logger.error("Failed to start Agent execution worker", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
