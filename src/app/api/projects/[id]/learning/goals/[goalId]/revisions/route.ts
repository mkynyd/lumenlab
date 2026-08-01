import { NextResponse } from "next/server";

import { learningRoute, parseStrictJson } from "@/lib/learning/server/http";
import { goalRevisionCommandSchema } from "@/lib/learning/server/input-schemas";
import { learningService } from "@/lib/learning/services";

type RouteContext = {
  params: Promise<{ id: string; goalId: string }>;
};

export async function POST(request: Request, { params }: RouteContext) {
  return learningRoute(async ({ userId }) => {
    const parsed = await parseStrictJson(request, goalRevisionCommandSchema);
    if (!parsed.success) return parsed.response;
    const { id: projectId, goalId } = await params;
    const result = await learningService.reviseGoal({
      userId,
      projectId,
      goalId,
      input: parsed.data,
    });
    return NextResponse.json(result, { status: 201 });
  });
}
