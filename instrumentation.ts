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

  // 任务 08.3：回收上传成功但从未绑定到消息的聊天附件（派发失败或客户端放弃）。
  // 只按受限 TTL 清理自己的行与对象，不触碰已绑定附件。
  try {
    const { cleanupUnboundChatAttachments } = await import(
      "@/lib/chat/message-attachments"
    );
    const cleaned = await cleanupUnboundChatAttachments();
    if (cleaned.rows > 0) {
      logger.info("Unbound chat attachments cleaned", cleaned);
    }
  } catch (error) {
    logger.error("Failed to clean unbound chat attachments", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // 任务 10：启动时补齐可能缺失的站内通知投影（幂等，可重复执行）。
  // 任务终态与通知在同一事务内提交，这里只兜底进程崩溃或历史数据。
  try {
    const { reconcileAgentExecutionNotifications } = await import(
      "@/lib/notifications/projection"
    );
    const reconciled = await reconcileAgentExecutionNotifications();
    if (reconciled.created > 0) {
      logger.info("Agent execution notifications reconciled", reconciled);
    }
  } catch (error) {
    logger.error("Failed to reconcile agent execution notifications", {
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
