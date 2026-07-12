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

    const run = await agentRuntime.run(
      mapAgentRunInput({
        userId: session.user.id,
        parsed,
        signal: request.signal,
      })
    );
    return createChatResponse(run);
  } catch (error) {
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
