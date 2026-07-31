import { NextResponse } from "next/server";

import { learningGoalCreateSchema } from "@/lib/learning/validators";
import { learningRoute, parseStrictJson } from "@/lib/learning/server/http";
import { learningService } from "@/lib/learning/services";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  return learningRoute(async ({ userId }) => {
    const { id: projectId } = await params;
    const result = await learningService.listGoals({ userId, projectId });
    return NextResponse.json(result);
  });
}

export async function POST(request: Request, { params }: RouteContext) {
  return learningRoute(async ({ userId }) => {
    const parsed = await parseStrictJson(request, learningGoalCreateSchema);
    if (!parsed.success) return parsed.response;
    const { id: projectId } = await params;
    const goal = await learningService.createGoal({
      userId,
      projectId,
      input: parsed.data,
    });
    return NextResponse.json({ goal }, { status: 201 });
  });
}
