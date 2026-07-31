import { NextResponse } from "next/server";

import { learningRoute, parseStrictJson } from "@/lib/learning/server/http";
import { scopeCommandSchema } from "@/lib/learning/server/input-schemas";
import { learningService } from "@/lib/learning/services";

type RouteContext = {
  params: Promise<{ id: string; goalId: string }>;
};

export async function GET(_request: Request, { params }: RouteContext) {
  return learningRoute(async ({ userId }) => {
    const { id: projectId, goalId } = await params;
    const scope = await learningService.getScope({
      userId,
      projectId,
      goalId,
    });
    return NextResponse.json({ scope });
  });
}

export async function PUT(request: Request, { params }: RouteContext) {
  return learningRoute(async ({ userId }) => {
    const parsed = await parseStrictJson(request, scopeCommandSchema);
    if (!parsed.success) return parsed.response;
    const { id: projectId, goalId } = await params;
    let scope;
    if (parsed.data.command === "confirm") {
      scope = await learningService.confirmScope({
        userId,
        projectId,
        goalId,
        input: {
          expectedVersion: parsed.data.expectedVersion,
          idempotencyKey: parsed.data.idempotencyKey,
        },
      });
    } else {
      scope = await learningService.saveScopeDraft({
        userId,
        projectId,
        goalId,
        input: {
          expectedVersion: parsed.data.expectedVersion,
          definition: parsed.data.definition,
          materialMode: parsed.data.materialMode,
          fileIds: parsed.data.fileIds,
          materialGaps: parsed.data.materialGaps,
          idempotencyKey: parsed.data.idempotencyKey,
        },
      });
    }
    return NextResponse.json({ scope });
  });
}
