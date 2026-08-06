import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifySendSchema } from "@/lib/validators";
import { sendVerificationEmail } from "@/lib/email/service";

export async function POST(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const ip = forwardedFor?.split(",")[0]?.trim() || "unknown";

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "请求格式错误" },
      { status: 400 }
    );
  }

  const parsed = verifySendSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { email } = parsed.data;

  // 已注册邮箱不再发验证邮件（注册页需要即时反馈）
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json(
      { error: { email: ["该邮箱已被注册"] } },
      { status: 409 }
    );
  }

  const result = await sendVerificationEmail({ email, ip });
  if (!result.ok) {
    if (result.reason === "rate_limited") {
      return NextResponse.json(
        { error: "请求太频繁，请稍后再试" },
        { status: 429 }
      );
    }
    return NextResponse.json(
      { error: "邮件发送失败，请稍后重试" },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, resendAfter: 60 });
}
