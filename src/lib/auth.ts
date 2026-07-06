import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { loginSchema } from "@/lib/validators";
import { prisma } from "@/lib/db";
import { authConfig } from "@/lib/auth.config";
import { buildUserAvatarUrl } from "@/lib/user-profile";
import { checkRateLimit, RateLimits } from "@/lib/rate-limit";

// 用于在用户不存在时执行一次耗时近似的 dummy bcrypt.compare，
// 防止攻击者通过响应时间枚举邮箱是否存在。
const DUMMY_HASH = bcrypt.hashSync("login-timing-dummy", 10);

function getClientIp(request: Request | undefined): string {
  const forwarded = request?.headers?.get?.("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return request?.headers?.get?.("x-real-ip") ?? "unknown";
}

async function recordLoginAttempt(
  email: string,
  ip: string,
  success: boolean
): Promise<void> {
  try {
    await prisma.loginAttempt.create({
      data: { email, ip, success },
    });
  } catch {
    // 审计写入失败不应阻断登录流程
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      id: "login",
      name: "Login",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const { email, password } = parsed.data;
        const ip = getClientIp(request as Request | undefined);

        // 按 IP + email 维度进行登录限流
        const rate = await checkRateLimit(
          `login:${ip}:${email}`,
          RateLimits.LOGIN.max,
          RateLimits.LOGIN.window
        );
        if (!rate.allowed) {
          await recordLoginAttempt(email, ip, false);
          return null;
        }

        const user = await prisma.user.findUnique({ where: { email } });

        // 无论用户是否存在都执行一次 bcrypt.compare，保持响应时间接近。
        const valid = user
          ? await bcrypt.compare(password, user.passwordHash)
          : await bcrypt.compare(password, DUMMY_HASH);

        if (!valid) {
          await recordLoginAttempt(email, ip, false);
          return null;
        }

        await recordLoginAttempt(email, ip, true);

        // 上面 valid 为 true 时 user 一定存在；此处 guard 用于类型安全。
        if (!user) {
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          avatarPreset: user.avatarPreset,
          image: buildUserAvatarUrl(user),
        };
      },
    }),
  ],
});
