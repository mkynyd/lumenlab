import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { registerSchema } from "@/lib/validators";
import { checkRateLimit, RateLimits } from "@/lib/rate-limit";
import { headers } from "next/headers";
import {
  RegistrationError,
  registerUserWithCode,
} from "@/lib/register-user";
import { registrationRepository } from "@/lib/data/registration-repository";

export async function POST(request: Request) {
  // 速率限制
  const forwardedFor = (await headers()).get("x-forwarded-for");
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

  try {
    const body = await request.json();
    const parsed = registerSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { email, password, registrationCode } = parsed.data;

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await registerUserWithCode(
      { email, passwordHash, registrationCode },
      {
        repository: registrationRepository,
        pepper: process.env.REGISTRATION_CODE_PEPPER || "",
      }
    );

    return NextResponse.json(
      {
        success: true,
        user: { id: user.id, email: user.email, name: user.name },
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof RegistrationError) {
      const status = error.code === "email_exists" ? 409 : 400;
      return NextResponse.json(
        {
          error:
            error.code === "email_exists"
              ? { email: [error.message] }
              : { registrationCode: [error.message] },
        },
        { status }
      );
    }
    return NextResponse.json(
      { error: "服务器内部错误，请稍后重试" },
      { status: 500 }
    );
  }
}
