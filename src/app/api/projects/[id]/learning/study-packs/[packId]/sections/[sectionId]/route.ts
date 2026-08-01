import { NextResponse } from "next/server";

import { learningRoute, parseStrictJson } from "@/lib/learning/server/http";
import { saveStudyPackSectionSchema } from "@/lib/learning/server/input-schemas";
import { learningService } from "@/lib/learning/services";

type RouteContext = {
  params: Promise<{ id: string; packId: string; sectionId: string }>;
};

export async function GET(_request: Request, { params }: RouteContext) {
  return learningRoute(async ({ userId }) => {
    const { id: projectId, packId, sectionId } = await params;
    const { pack } = await learningService.getStudyPack({
      userId,
      projectId,
      packId,
    });
    const section = pack.sections.find(
      (candidate) => candidate.id === sectionId
    );
    if (!section) {
      return NextResponse.json(
        {
          error: {
            code: "not_found",
            message: "资料包章节不存在",
          },
        },
        { status: 404 }
      );
    }
    return NextResponse.json({ section });
  });
}

export async function PATCH(request: Request, { params }: RouteContext) {
  return learningRoute(async ({ userId }) => {
    const parsed = await parseStrictJson(request, saveStudyPackSectionSchema);
    if (!parsed.success) return parsed.response;
    const { id: projectId, packId, sectionId } = await params;
    const result = await learningService.saveStudyPackSection({
      userId,
      projectId,
      packId,
      sectionId,
      input: parsed.data,
    });
    return NextResponse.json(result);
  });
}
