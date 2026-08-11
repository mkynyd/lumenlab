import { NextResponse } from "next/server";

import { learningRoute, parseStrictJson } from "@/lib/learning/server/http";
import { goalStatusCommandSchema } from "@/lib/learning/server/input-schemas";
import { learningService } from "@/lib/learning/services";

type RouteContext = {
  params: Promise<{ id: string; goalId: string }>;
};

export async function GET(_request: Request, { params }: RouteContext) {
  return learningRoute(async ({ userId }) => {
    const { id: projectId, goalId } = await params;
    const goal = await learningService.getGoal({
      userId,
      projectId,
      goalId,
    });
    return NextResponse.json({ goal });
  });
}

export async function PATCH(request: Request, { params }: RouteContext) {
  return learningRoute(async ({ userId }) => {
    const parsed = await parseStrictJson(request, goalStatusCommandSchema);
    if (!parsed.success) return parsed.response;
    const { id: projectId, goalId } = await params;
    const goal = await learningService.updateGoalStatus({
      userId,
      projectId,
      goalId,
      input: parsed.data,
    });
    return NextResponse.json({ goal });
  });
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  return learningRoute(async ({ userId }) => {
    const { id: projectId, goalId } = await params;
    await learningService.deleteGoal({ userId, projectId, goalId });
    return NextResponse.json({ success: true });
  });
}
