import { NextResponse } from "next/server";
import { identitySettingsUser } from "@/lib/auth/identity-settings";
import { parseLoginIdentifier } from "@/lib/auth/identifier";
import { verifyCodeSchema } from "@/lib/validators";
import { verifyWithCode } from "@/lib/auth-challenge";
import { authChallengeRepository } from "@/lib/data/auth-challenge-repository";
import { checkRateLimit, RateLimits } from "@/lib/rate-limit";

export async function POST(request: Request) {
  const user = await identitySettingsUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = verifyCodeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "请输入有效的身份与 6 位验证码" }, { status: 400 });
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rate = await checkRateLimit(`bind-code:${ip}`, RateLimits.VERIFY_CODE_IP.max, RateLimits.VERIFY_CODE_IP.window);
  if (!rate.allowed) return NextResponse.json({ error: "请求太频繁，请稍后重试" }, { status: 429 });
  const identifier = parseLoginIdentifier(parsed.data.identifier ?? parsed.data.email)!;
  const result = await verifyWithCode({ target: identifier.providerAccountId, channel: identifier.channel, purpose: "bind_identity", userId: user.id, code: parsed.data.code }, { repository: authChallengeRepository });
  if (!result.ok) return NextResponse.json({ error: "验证码错误、过期或已使用，请重新验证" }, { status: 400 });
  return NextResponse.json({ success: true, ticket: result.ticket });
}
