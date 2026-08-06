import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifySendSchema } from "@/lib/validators";
import { sendPasswordResetEmail } from "@/lib/email/service";

/**
 * 密码重设邮件发送。对不存在的邮箱返回统一成功提示，防账号枚举。
 */
export async function POST(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const ip = forwardedFor?.split(",")[0]?.trim() || "unknown";

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const parsed = verifySendSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { email } = parsed.data;

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (user) {
    await sendPasswordResetEmail({ email, userId: user.id, ip });
  }
  // 无论用户是否存在都返回统一成功，防枚举
  return NextResponse.json({ success: true });
}
