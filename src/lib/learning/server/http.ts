import "server-only";

import { NextResponse } from "next/server";
import type { z } from "zod";

import { auth } from "@/lib/auth";
import {
  LearningServiceError,
  type LearningErrorCode,
} from "@/lib/learning/contracts";
import { learningFeatureFlags } from "@/lib/learning/feature-flags";

type AuthenticatedHandler = (context: { userId: string }) => Promise<Response>;

function errorResponse(
  code: LearningErrorCode,
  message: string,
  status: number,
  details?: unknown
) {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        ...(details === undefined ? {} : { details }),
      },
    },
    { status }
  );
}

export async function learningRoute(
  handler: AuthenticatedHandler
): Promise<Response> {
  if (!learningFeatureFlags.apiEnabled) {
    return errorResponse(
      "learning_disabled",
      "学习功能当前未开放",
      404
    );
  }
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      {
        error: {
          code: "unauthorized",
          message: "请先登录",
        },
      },
      { status: 401 }
    );
  }
  try {
    return await handler({ userId: session.user.id });
  } catch (error) {
    if (error instanceof LearningServiceError) {
      return errorResponse(error.code, error.message, error.status);
    }
    return errorResponse(
      "invalid_state",
      "学习服务暂时不可用",
      500
    );
  }
}

export async function parseStrictJson<T>(
  request: Request,
  schema: z.ZodType<T>
): Promise<
  | { success: true; data: T }
  | { success: false; response: Response }
> {
  try {
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return {
        success: false,
        response: errorResponse(
          "invalid_state",
          "请求参数无效",
          400,
          parsed.error.flatten()
        ),
      };
    }
    return { success: true, data: parsed.data };
  } catch {
    return {
      success: false,
      response: errorResponse(
        "invalid_state",
        "无效的 JSON 格式",
        400
      ),
    };
  }
}
