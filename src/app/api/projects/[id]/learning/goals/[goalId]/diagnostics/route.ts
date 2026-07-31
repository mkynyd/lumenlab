import { NextResponse } from "next/server";

import { learningRoute, parseStrictJson } from "@/lib/learning/server/http";
import { idempotentGenerationSchema } from "@/lib/learning/server/input-schemas";
import { learningService } from "@/lib/learning/services";

type RouteContext = {
  params: Promise<{ id: string; goalId: string }>;
};

export async function POST(request: Request, { params }: RouteContext) {
  return learningRoute(async ({ userId }) => {
    const parsed = await parseStrictJson(
      request,
      idempotentGenerationSchema
    );
    if (!parsed.success) return parsed.response;
    const { id: projectId, goalId } = await params;
    const session = await learningService.createDiagnosticSession({
      userId,
      projectId,
      goalId,
      input: parsed.data,
    });
    return NextResponse.json({ session }, { status: 201 });
  });
}
