import { NextResponse } from "next/server";
import { verifyCodeSchema } from "@/lib/validators";
import { checkRateLimit, RateLimits } from "@/lib/rate-limit";
import { verifyWithCode } from "@/lib/auth-challenge";
import { authChallengeRepository } from "@/lib/data/auth-challenge-repository";

const CODE_ERROR_MESSAGES: Record<string, string> = {
  no_challenge: "请先获取验证码",
  already_verified: "该邮箱已完成验证",
  expired: "验证码已过期，请重新获取",
  invalid_code: "验证码错误",
  attempts_exceeded: "尝试次数过多，请重新获取验证码",
};

export async function POST(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const ip = forwardedFor?.split(",")[0]?.trim() || "unknown";

  const { allowed } = await checkRateLimit(
    `verify-code:${ip}`,
    RateLimits.VERIFY_CODE_IP.max,
    RateLimits.VERIFY_CODE_IP.window
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
    return NextResponse.json(
      { error: "请求格式错误" },
      { status: 400 }
    );
  }

  const parsed = verifyCodeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { email, code } = parsed.data;
  const result = await verifyWithCode(
    { type: "verify", email, code },
    { repository: authChallengeRepository }
  );
  if (!result.ok) {
    return NextResponse.json(
      { error: { code: [CODE_ERROR_MESSAGES[result.reason]] } },
      { status: 400 }
    );
  }

  return NextResponse.json({ success: true, ticket: result.ticket });
}
