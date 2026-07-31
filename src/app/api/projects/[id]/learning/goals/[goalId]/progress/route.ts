import { NextResponse } from "next/server";

import { learningRoute } from "@/lib/learning/server/http";
import { learningService } from "@/lib/learning/services";

type RouteContext = {
  params: Promise<{ id: string; goalId: string }>;
};

export async function GET(_request: Request, { params }: RouteContext) {
  return learningRoute(async ({ userId }) => {
    const { id: projectId, goalId } = await params;
    const result = await learningService.getProgress({
      userId,
      projectId,
      goalId,
    });
    return NextResponse.json(result);
  });
}
