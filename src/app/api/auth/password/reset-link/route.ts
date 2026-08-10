import { NextResponse, type NextRequest } from "next/server";
import { sha256, splitRawToken } from "@/lib/auth-challenge";
import { resolveAppOrigin } from "@/lib/app-origin";
import { passwordResetRepository } from "@/lib/data/password-reset-repository";

/**
 * 重设邮件链接的 GET 入口。只校验不消费（防误点浪费 token），
 * 校验通过后带原 token 跳转重设页，POST 确认时原子消费。
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") || "";
  const origin = resolveAppOrigin(request.nextUrl.origin);

  const split = splitRawToken(token);
  let valid = false;
  if (split) {
    const challenge = await passwordResetRepository.findResetToken(split.id);
    valid =
      challenge !== null &&
      challenge.tokenHash === sha256(split.raw) &&
      !challenge.tokenConsumedAt &&
      challenge.tokenExpiresAt !== null &&
      challenge.tokenExpiresAt.getTime() > Date.now();
  }

  if (!valid) {
    return NextResponse.redirect(new URL("/reset-password?invalid=1", origin));
  }

  const resetUrl = new URL("/reset-password", origin);
  resetUrl.searchParams.set("ticket", token);
  return NextResponse.redirect(resetUrl);
}
