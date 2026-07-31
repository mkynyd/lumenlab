import { NextResponse } from "next/server";

import { learningRoute } from "@/lib/learning/server/http";
import { learningService } from "@/lib/learning/services";

type RouteContext = {
  params: Promise<{ id: string; sessionId: string }>;
};

export async function GET(_request: Request, { params }: RouteContext) {
  return learningRoute(async ({ userId }) => {
    const { id: projectId, sessionId } = await params;
    const session = await learningService.getSession({
      userId,
      projectId,
      sessionId,
    });
    return NextResponse.json({ session });
  });
}
