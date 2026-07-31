import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkRateLimit, RateLimits } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import {
  agentRuntime,
  AgentRuntimeError,
} from "@/lib/agent/runtime";
import {
  mapAgentRunInput,
  parseChatRequest,
} from "./request-mapper";
import { createChatResponse } from "./response-stream";
import { learningFeatureFlags } from "@/lib/learning/feature-flags";
import { dispatchDurableChat } from "@/lib/agent/executions/durable-chat-dispatcher";
import { createDurableReplayResponse } from "@/lib/agent/executions/durable-response-stream";
import { startAgentExecutionWorker } from "@/lib/agent/executions/durable-agent-runtime";
import { AgentExecutionStoreError } from "@/lib/agent/executions/agent-execution-store";

export { accumulateAndSave } from "@/lib/agent/runtime";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "请先登录" }, { status: 401 });
    }

    const { allowed } = await checkRateLimit(
      `chat:${session.user.id}`,
      RateLimits.CHAT.max,
      RateLimits.CHAT.window
    );
    if (!allowed) {
      return NextResponse.json(
        { error: "请求太频繁，请稍后重试" },
        { status: 429 }
      );
    }

    let parsed;
    try {
      parsed = await parseChatRequest(request);
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error ? error.message : "无效的请求格式",
        },
        { status: 400 }
      );
    }

    const runInput = mapAgentRunInput({
      userId: session.user.id,
      parsed,
      signal: request.signal,
    });
    if (
      learningFeatureFlags.durableExecutionEnabled &&
      parsed.attachments.length === 0
    ) {
      if (!parsed.body.clientRunKey) {
        return NextResponse.json(
          { error: "启用持久执行时缺少 clientRunKey" },
          { status: 400 }
        );
      }
      const dispatched = await dispatchDurableChat({
        userId: session.user.id,
        clientRunKey: parsed.body.clientRunKey,
        runInput,
      });
      startAgentExecutionWorker();
      return createDurableReplayResponse({
        store: dispatched.store,
        execution: dispatched.execution,
        userId: session.user.id,
        signal: request.signal,
        format: "chat",
        chatHeaders: true,
      });
    }

    const run = await agentRuntime.run(runInput);
    return createChatResponse(run);
  } catch (error) {
    if (error instanceof AgentExecutionStoreError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        {
          status:
            error.code === "execution_not_found"
              ? 404
              : error.code === "idempotency_key_reused" ||
                  error.code === "conversation_execution_in_progress"
                ? 409
                : 400,
        }
      );
    }
    if (error instanceof AgentRuntimeError) {
      return NextResponse.json(
        { error: error.message, ...error.details },
        { status: error.status }
      );
    }

    logger.error("chat route failed", {
      error: String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "聊天请求失败" },
      { status: 500 }
    );
  }
}
