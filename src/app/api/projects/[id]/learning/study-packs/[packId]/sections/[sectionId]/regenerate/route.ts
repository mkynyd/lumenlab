import { NextResponse } from "next/server";

import { learningRoute, parseStrictJson } from "@/lib/learning/server/http";
import { generateStudyPackSchema } from "@/lib/learning/server/input-schemas";
import { learningService } from "@/lib/learning/services";

type RouteContext = {
  params: Promise<{ id: string; packId: string; sectionId: string }>;
};

export async function POST(request: Request, { params }: RouteContext) {
  return learningRoute(async ({ userId }) => {
    const parsed = await parseStrictJson(request, generateStudyPackSchema);
    if (!parsed.success) return parsed.response;
    const { id: projectId, packId, sectionId } = await params;
    const result = await learningService.regenerateStudyPackSection({
      userId,
      projectId,
      packId,
      sectionId,
      input: parsed.data,
    });
    return NextResponse.json(result);
  });
}
