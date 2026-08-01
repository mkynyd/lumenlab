import { NextResponse } from "next/server";

import { learningRoute, parseStrictJson } from "@/lib/learning/server/http";
import { profileResetCommandSchema } from "@/lib/learning/server/input-schemas";
import { learningService } from "@/lib/learning/services";

export async function POST(request: Request) {
  return learningRoute(async ({ userId }) => {
    const parsed = await parseStrictJson(request, profileResetCommandSchema);
    if (!parsed.success) return parsed.response;
    if (parsed.data.scope.kind !== "user") {
      return NextResponse.json(
        {
          error: {
            code: "invalid_state",
            message: "全局重置只支持用户级范围",
          },
        },
        { status: 400 }
      );
    }
    const result = await learningService.resetProfile({
      userId,
      input: parsed.data,
    });
    return NextResponse.json(result, { status: 201 });
  });
}
