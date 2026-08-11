import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { checkRateLimit, RateLimits } from "@/lib/rate-limit";
import { recordErrorEvent } from "@/lib/feedback/events";

const reportSchema = z.object({
  message: z.string().min(1).max(500),
  stack: z.string().max(4000).optional(),
  route: z.string().max(500).optional(),
});

// 错误上报是「尽力而为」通道：任何异常都返回 204，绝不把上报自身的失败暴露给用户。
export async function POST(request: Request) {
  try {
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const limit = await checkRateLimit(
      `error-report:${ip}`,
      RateLimits.ERROR_REPORT.max,
      RateLimits.ERROR_REPORT.window
    );
    if (!limit.allowed) {
      return new NextResponse(null, { status: 204 });
    }

    const parsed = reportSchema.safeParse(await request.json());
    if (!parsed.success) {
      return new NextResponse(null, { status: 204 });
    }

    const session = await auth();
    await recordErrorEvent({
      source: "client",
      message: parsed.data.message,
      stack: parsed.data.stack ?? null,
      route: parsed.data.route ?? null,
      userId: session?.user?.id ?? null,
      userAgent: request.headers.get("user-agent"),
    });
  } catch (error) {
    console.error("错误上报处理失败", error);
  }
  return new NextResponse(null, { status: 204 });
}
