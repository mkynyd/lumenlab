import { NextResponse } from "next/server";

import { learningRoute, parseStrictJson } from "@/lib/learning/server/http";
import { learningService } from "@/lib/learning/services";
import { practiceAttemptSubmissionSchema } from "@/lib/learning/validators";

type RouteContext = {
  params: Promise<{
    id: string;
    sessionId: string;
    sessionItemId: string;
  }>;
};

export async function POST(request: Request, { params }: RouteContext) {
  return learningRoute(async ({ userId }) => {
    const parsed = await parseStrictJson(
      request,
      practiceAttemptSubmissionSchema
    );
    if (!parsed.success) return parsed.response;
    const {
      id: projectId,
      sessionId,
      sessionItemId,
    } = await params;
    const result = await learningService.submitAttempt({
      userId,
      projectId,
      sessionId,
      sessionItemId,
      input: parsed.data,
    });
    return NextResponse.json(result, { status: 201 });
  });
}
