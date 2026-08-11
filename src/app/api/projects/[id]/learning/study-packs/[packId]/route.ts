import { NextResponse } from "next/server";

import { learningRoute } from "@/lib/learning/server/http";
import { learningService } from "@/lib/learning/services";

type RouteContext = {
  params: Promise<{ id: string; packId: string }>;
};

export async function GET(_request: Request, { params }: RouteContext) {
  return learningRoute(async ({ userId }) => {
    const { id: projectId, packId } = await params;
    const result = await learningService.getStudyPack({
      userId,
      projectId,
      packId,
    });
    return NextResponse.json(result);
  });
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  return learningRoute(async ({ userId }) => {
    const { id: projectId, packId } = await params;
    await learningService.deleteStudyPack({ userId, projectId, packId });
    return NextResponse.json({ success: true });
  });
}
