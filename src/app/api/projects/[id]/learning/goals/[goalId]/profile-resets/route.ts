import { NextResponse } from "next/server";

import { learningRoute, parseStrictJson } from "@/lib/learning/server/http";
import { profileResetCommandSchema } from "@/lib/learning/server/input-schemas";
import { learningService } from "@/lib/learning/services";

type RouteContext = {
  params: Promise<{ id: string; goalId: string }>;
};

export async function POST(request: Request, { params }: RouteContext) {
  return learningRoute(async ({ userId }) => {
    const parsed = await parseStrictJson(request, profileResetCommandSchema);
    if (!parsed.success) return parsed.response;
    const { id: projectId, goalId: routeGoalId } = await params;
    const input = parsed.data;
    if (input.scope.kind === "user") {
      return NextResponse.json(
        {
          error: {
            code: "invalid_state",
            message: "该路由不支持用户级重置",
          },
        },
        { status: 400 }
      );
    }
    if (input.scope.goalId !== routeGoalId) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_state",
            message: "请求中的学习目标与路由不匹配",
          },
        },
        { status: 400 }
      );
    }
    const result = await learningService.resetProfile({
      userId,
      projectId,
      input,
    });
    return NextResponse.json(result, { status: 201 });
  });
}
