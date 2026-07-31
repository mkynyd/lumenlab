import { NextResponse } from "next/server";

import { learningRoute, parseStrictJson } from "@/lib/learning/server/http";
import { reviewSessionCommandSchema } from "@/lib/learning/server/input-schemas";
import { learningService } from "@/lib/learning/services";

type RouteContext = {
  params: Promise<{ id: string; goalId: string }>;
};

export async function GET(_request: Request, { params }: RouteContext) {
  return learningRoute(async ({ userId }) => {
    const { id: projectId, goalId } = await params;
    const result = await learningService.listReviews({
      userId,
      projectId,
      goalId,
    });
    return NextResponse.json(result);
  });
}

export async function POST(request: Request, { params }: RouteContext) {
  return learningRoute(async ({ userId }) => {
    const parsed = await parseStrictJson(
      request,
      reviewSessionCommandSchema
    );
    if (!parsed.success) return parsed.response;
    const { id: projectId, goalId } = await params;
    const session = await learningService.createReviewSession({
      userId,
      projectId,
      goalId,
      input: parsed.data,
    });
    return NextResponse.json({ session }, { status: 201 });
  });
}
