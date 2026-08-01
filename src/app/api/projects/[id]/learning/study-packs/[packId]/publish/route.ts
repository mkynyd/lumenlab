import { NextResponse } from "next/server";

import { learningRoute, parseStrictJson } from "@/lib/learning/server/http";
import { publishStudyPackSchema } from "@/lib/learning/server/input-schemas";
import { learningService } from "@/lib/learning/services";

type RouteContext = {
  params: Promise<{ id: string; packId: string }>;
};

export async function POST(request: Request, { params }: RouteContext) {
  return learningRoute(async ({ userId }) => {
    const parsed = await parseStrictJson(request, publishStudyPackSchema);
    if (!parsed.success) return parsed.response;
    const { id: projectId, packId } = await params;
    const result = await learningService.publishStudyPack({
      userId,
      projectId,
      packId,
      input: parsed.data,
    });
    return NextResponse.json(result, { status: 201 });
  });
}
