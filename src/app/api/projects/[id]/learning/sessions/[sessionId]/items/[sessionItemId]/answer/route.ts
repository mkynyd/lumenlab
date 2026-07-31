import { NextResponse } from "next/server";

import { learningRoute, parseStrictJson } from "@/lib/learning/server/http";
import { interactionCommandSchema } from "@/lib/learning/server/input-schemas";
import { learningService } from "@/lib/learning/services";

type RouteContext = {
  params: Promise<{
    id: string;
    sessionId: string;
    sessionItemId: string;
  }>;
};

export async function POST(request: Request, { params }: RouteContext) {
  return learningRoute(async ({ userId }) => {
    const parsed = await parseStrictJson(request, interactionCommandSchema);
    if (!parsed.success) return parsed.response;
    const {
      id: projectId,
      sessionId,
      sessionItemId,
    } = await params;
    const result = await learningService.revealAnswer({
      userId,
      projectId,
      sessionId,
      sessionItemId,
      input: parsed.data,
    });
    return NextResponse.json(result);
  });
}
