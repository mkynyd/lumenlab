import { NextResponse } from "next/server";
import { verifySendSchema } from "@/lib/validators";
import { sendVerificationEmail } from "@/lib/email/service";
import { parseLoginIdentifier } from "@/lib/auth/identifier";
import { sendVerificationSms } from "@/lib/sms/service";
import { smsFailureResponse } from "@/lib/auth/identity-api";
import { checkIdentifierAvailability, checkEmailAvailability } from "@/lib/auth/service";

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

  const identifier = parseLoginIdentifier(parsed.data.identifier ?? parsed.data.email)!;
  const email = identifier.providerAccountId;

  // 已注册邮箱不再发验证邮件（注册页需要即时反馈）。
  // 走身份层检查：既覆盖 AuthIdentity，也覆盖 migration 窗口内只有 legacy
  // `User.email` 的历史账户，以及 identity 与 legacy 落到不同账户的冲突情况。
  const availability = identifier.type === "email" ? await checkEmailAvailability(email) : await checkIdentifierAvailability(email);
  if (availability.kind === "taken" || availability.kind === "conflict") {
    return NextResponse.json(
      { error: identifier.type === "email" ? { email: ["该邮箱已被注册"] } : "该手机号已被注册" },
      { status: 409 }
    );
  }

  if (identifier.type === "phone") {
    try {
      const sms = await sendVerificationSms({ phone: email, purpose: "register", ip });
      return sms.ok ? NextResponse.json({ success: true, resendAfter: sms.resendAfter }) : smsFailureResponse(sms);
    } catch {
      return NextResponse.json({ error: "验证码服务暂不可用" }, { status: 503 });
    }
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
