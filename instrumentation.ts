import type { Instrumentation } from "next";
import { logger } from "@/lib/logger";

// Next.js 服务端错误统一入口：路由 / RSC / Server Action 抛出的未捕获错误都会经过这里。
export const onRequestError: Instrumentation.onRequestError = async (
  err,
  request,
  context
) => {
  if (process.env.NEXT_RUNTIME === "edge") return;
  // 动态导入避免 instrumentation 在构建/edge 阶段拉起 Prisma。
  const { recordServerError } = await import("@/lib/feedback/events");
  await recordServerError(err, context.routePath ?? request.path);
};

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
