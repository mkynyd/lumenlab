import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkRateLimit, RateLimits } from "@/lib/rate-limit";

const feedbackSchema = z.object({
  category: z.enum(["bug", "suggestion", "other"]),
  content: z.string().min(1, "请填写反馈内容").max(2000),
  contact: z.string().max(200).optional(),
  pagePath: z.string().min(1).max(500),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const limit = await checkRateLimit(
    `feedback:${session.user.id}`,
    RateLimits.FEEDBACK.max,
    RateLimits.FEEDBACK.window
  );
  if (!limit.allowed) {
    return NextResponse.json({ error: "提交太频繁，请明天再试" }, { status: 429 });
  }

  let body: z.infer<typeof feedbackSchema>;
  try {
    const parsed = feedbackSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    body = parsed.data;
  } catch {
    return NextResponse.json({ error: "无效的 JSON 格式" }, { status: 400 });
  }

  const feedback = await prisma.feedback.create({
    data: {
      userId: session.user.id,
      category: body.category,
      content: body.content,
      contact: body.contact || null,
      pagePath: body.pagePath,
      userAgent: request.headers.get("user-agent") ?? "",
    },
  });

  return NextResponse.json({ id: feedback.id }, { status: 201 });
}
