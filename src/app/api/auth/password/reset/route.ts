import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { resetPasswordSchema } from "@/lib/validators";
import { checkRateLimit, RateLimits } from "@/lib/rate-limit";
import { confirmPasswordReset } from "@/lib/password-reset";
import { passwordResetRepository } from "@/lib/data/password-reset-repository";

const RESET_ERROR_MESSAGES: Record<string, string> = {
  invalid: "重设链接无效，请重新申请",
  expired: "重设链接已过期，请重新申请",
  used: "重设链接已被使用，请重新申请",
  user_not_found: "重设链接无效，请重新申请",
};

export async function POST(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const ip = forwardedFor?.split(",")[0]?.trim() || "unknown";

  const { allowed } = await checkRateLimit(
    `password-reset:${ip}`,
    RateLimits.PASSWORD_RESET_IP.max,
    RateLimits.PASSWORD_RESET_IP.window
  );
  if (!allowed) {
    return NextResponse.json(
      { error: "请求太频繁，请稍后再试" },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const parsed = resetPasswordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { ticket, password } = parsed.data;
  const passwordHash = await bcrypt.hash(password, 12);
  const result = await confirmPasswordReset(
    { ticket, passwordHash },
    { repository: passwordResetRepository }
  );

  if (!result.ok) {
    return NextResponse.json(
      { error: { ticket: [RESET_ERROR_MESSAGES[result.reason]] } },
      { status: 400 }
    );
  }

  return NextResponse.json({ success: true });
}
