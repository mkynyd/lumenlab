import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { registerSchema } from "@/lib/validators";
import { checkRateLimit, RateLimits } from "@/lib/rate-limit";
import {
  RegistrationError,
  registerUserWithTicket,
} from "@/lib/register-user";
import { registrationRepository } from "@/lib/data/registration-repository";

export async function POST(request: Request) {
  // 速率限制
  const forwardedFor = request.headers.get("x-forwarded-for");
  const ip = forwardedFor?.split(",")[0]?.trim() || "unknown";
  const { allowed } = await checkRateLimit(
    `register:${ip}`,
    RateLimits.REGISTER.max,
    RateLimits.REGISTER.window
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

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { identifier, email, password, ticket } = parsed.data;

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await registerUserWithTicket(
      { identifier, email, passwordHash, ticket },
      { repository: registrationRepository }
    );

    return NextResponse.json(
      {
        success: true,
        user: { id: user.id, email: user.email, name: user.name },
      },
      { status: 201 }
    );
  } catch (error) {
    return handleRegistrationError(error);
  }
}

export function handleRegistrationError(error: unknown) {
  if (error instanceof RegistrationError) {
    switch (error.code) {
      case "identifier_exists":
      case "identity_conflict":
      case "identity_already_bound":
        return NextResponse.json({ error: error.message }, { status: 409 });
      case "identifier_invalid":
        return NextResponse.json({ error: error.message }, { status: 400 });
      case "email_exists":
        return NextResponse.json(
          { error: { email: [error.message] } },
          { status: 409 }
        );
      case "email_not_verified":
        return NextResponse.json(
          { error: { email: [error.message] } },
          { status: 400 }
        );
      case "profile_unavailable":
        // 基础设施故障而非用户输入错误：errorField 为 null，不占限流
        return NextResponse.json(
          { error: error.message },
          { status: 503 }
        );
      default:
        // ticket_invalid / ticket_expired / ticket_consumed 统一文案防探测
        return NextResponse.json(
          { error: { ticket: [error.message] } },
          { status: 400 }
        );
    }
  }
  if (typeof error === "object" && error !== null && "code" in error && ["P2002", "P2034"].includes(String(error.code))) {
    return NextResponse.json({ error: "身份已被占用或请求冲突，请重新尝试" }, { status: 409 });
  }
  return NextResponse.json(
    { error: "服务器内部错误，请稍后重试" },
    { status: 500 }
  );
}
