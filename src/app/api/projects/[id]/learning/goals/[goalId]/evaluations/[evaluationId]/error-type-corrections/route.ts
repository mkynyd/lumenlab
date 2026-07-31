import { NextResponse } from "next/server";

import { learningRoute, parseStrictJson } from "@/lib/learning/server/http";
import { errorTypeCorrectionCommandSchema } from "@/lib/learning/server/input-schemas";
import { learningService } from "@/lib/learning/services";

type RouteContext = {
  params: Promise<{
    id: string;
    goalId: string;
    evaluationId: string;
  }>;
};

export async function POST(request: Request, { params }: RouteContext) {
  return learningRoute(async ({ userId }) => {
    const parsed = await parseStrictJson(
      request,
      errorTypeCorrectionCommandSchema
    );
    if (!parsed.success) return parsed.response;
    const { id: projectId, goalId, evaluationId } = await params;
    const result = await learningService.correctEvaluationErrorType({
      userId,
      projectId,
      goalId,
      evaluationId,
      input: parsed.data,
    });
    return NextResponse.json(result, { status: 201 });
  });
}
