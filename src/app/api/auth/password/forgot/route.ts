import { NextResponse } from "next/server";
import { forgotPasswordSchema } from "@/lib/validators";
import { sendPasswordResetEmail } from "@/lib/email/service";
import { resolveEmail } from "@/lib/auth/service";

/**
 * 密码重设邮件发送。对不存在的邮箱返回统一成功提示，防账号枚举。
 *
 * 身份解析走统一 resolver：AuthIdentity 优先；migration 窗口内只有 legacy
 * `User.email` 的历史账户同样能收到重设邮件（并在此幂等 self-heal）。
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

  const parsed = forgotPasswordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { email } = parsed.data;

  const resolution = await resolveEmail(email);
  if (resolution.kind === "resolved") {
    await sendPasswordResetEmail({
      email,
      userId: resolution.identity.userId,
      ip,
    });
  }
  // ambiguous（identity 与 legacy 落到不同账户）也返回统一成功，
  // 不向调用方泄露账户冲突细节。
  // 无论用户是否存在都返回统一成功，防枚举
  return NextResponse.json({ success: true });
}
