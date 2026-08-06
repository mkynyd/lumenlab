import { NextResponse, type NextRequest } from "next/server";
import { verifyWithLink } from "@/lib/auth-challenge";
import { authChallengeRepository } from "@/lib/data/auth-challenge-repository";

/**
 * 邮件中的一次性验证链接。消费后签发注册票据并跳转注册页
 * （/register?verified=1&ticket=...&email=...），失败统一跳失败提示。
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") || "";
  const origin = request.nextUrl.origin;

  const result = await verifyWithLink(
    { token },
    { repository: authChallengeRepository }
  );
  if (!result.ok) {
    return NextResponse.redirect(
      new URL("/register?verify=failed", origin)
    );
  }

  const registerUrl = new URL("/register", origin);
  registerUrl.searchParams.set("verified", "1");
  registerUrl.searchParams.set("ticket", result.ticket);
  registerUrl.searchParams.set("email", result.email);
  return NextResponse.redirect(registerUrl);
}
