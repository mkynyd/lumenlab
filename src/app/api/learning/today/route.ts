import { NextResponse } from "next/server";

import { learningRoute } from "@/lib/learning/server/http";
import { learningService } from "@/lib/learning/services";

export async function GET() {
  return learningRoute(async ({ userId }) => {
    const result = await learningService.getToday({ userId });
    return NextResponse.json(result);
  });
}
