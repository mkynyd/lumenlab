import { NextResponse } from "next/server";
import { identitySettingsUser } from "@/lib/auth/identity-settings";
import { authIdentityRepository } from "@/lib/auth/service";
import { assertCanBindIdentity } from "@/lib/auth/bind-identity";
import { parseLoginIdentifier } from "@/lib/auth/identifier";
import { verifySendSchema } from "@/lib/validators";
import { sendVerificationEmail } from "@/lib/email/service";
import { sendVerificationSms } from "@/lib/sms/service";
import { smsFailureResponse } from "@/lib/auth/identity-api";
import { handleRegistrationError } from "@/app/api/auth/register/route";

export async function POST(request: Request) {
  const user = await identitySettingsUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = verifySendSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "请输入有效的邮箱或大陆手机号" }, { status: 400 });
  const identifier = parseLoginIdentifier(parsed.data.identifier ?? parsed.data.email)!;
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  try {
    await assertCanBindIdentity(user.id, identifier.providerAccountId, identifier.type, authIdentityRepository);
    if (identifier.type === "phone") {
      const result = await sendVerificationSms({ phone: identifier.providerAccountId, purpose: "bind_identity", userId: user.id, ip });
      return result.ok ? NextResponse.json({ success: true, resendAfter: 60 }) : smsFailureResponse(result);
    }
    const result = await sendVerificationEmail({ email: identifier.providerAccountId, purpose: "bind_identity", userId: user.id, ip });
    if (!result.ok) return NextResponse.json({ error: "邮件发送失败，请稍后重试" }, { status: result.reason === "rate_limited" ? 429 : result.reason === "unavailable" ? 503 : 502 });
    return NextResponse.json({ success: true, resendAfter: 60 });
  } catch (error) { return handleRegistrationError(error); }
}
