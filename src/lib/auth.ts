import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { loginSchema } from "@/lib/validators";
import { prisma } from "@/lib/db";
import { authConfig } from "@/lib/auth.config";
import { buildUserAvatarUrl } from "@/lib/user-profile";
import { checkRateLimit, RateLimits } from "@/lib/rate-limit";
import { getPasswordChangedAt } from "@/lib/password-version";

// 用于在用户不存在时执行一次耗时近似的 dummy bcrypt.compare，
// 防止攻击者通过响应时间枚举邮箱是否存在。
const DUMMY_HASH = bcrypt.hashSync("login-timing-dummy", 10);

/** 邮箱未验证时抛出，signIn 返回的 result.code 为 "email_not_verified" */
class EmailNotVerifiedError extends CredentialsSignin {
  code = "email_not_verified";
}

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

        // 上面 valid 为 true 时 user 一定存在；此处 guard 用于类型安全。
        if (!user) {
          return null;
        }

        // 未完成邮箱验证的账号拒绝登录（老用户由迁移 backfill 标记为已验证）。
        // 放在密码比较之后，保持 dummy-hash 时序防护。
        if (!user.emailVerifiedAt) {
          await recordLoginAttempt(email, ip, false);
          throw new EmailNotVerifiedError();
        }

        await recordLoginAttempt(email, ip, true);

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          avatarPreset: user.avatarPreset,
          image: buildUserAvatarUrl(user),
          // 密码版本：重设密码后旧 JWT 经 pwchg claim 失效
          passwordChangedAt: user.passwordChangedAt?.getTime() ?? null,
        };
      },
    }),
  ],
  // Node runtime 实例：在基础字段上追加 pwchg 失效校验（proxy Edge 分支
  // 用 authConfig.jwt，不查库；数据面请求都走本实例的 auth()）。
  callbacks: {
    ...authConfig.callbacks,
    async jwt(params) {
      const { token, user, trigger, session } = params;
      if (user) {
        token.id = user.id as string;
        token.name = user.name;
        token.email = user.email;
        token.avatarPreset = user.avatarPreset ?? null;
        token.picture = user.image ?? null;
        // passwordChangedAt 为 authorize 返回的自定义字段（epoch ms）
        token.pwchg =
          (user as { passwordChangedAt?: number | null }).passwordChangedAt ??
          null;
      }
      if (trigger === "update" && session?.user) {
        token.name = session.user.name;
        token.avatarPreset = session.user.avatarPreset ?? null;
        token.picture = session.user.image ?? null;
      }
      // 重设密码后旧 JWT 立即失效：token 内 pwchg 与当前值不一致则清空 token。
      // 旧 token 无 pwchg 字段也参与对比（改过密的用户其老会话一并踢出）。
      if (token.id) {
        const current = await getPasswordChangedAt(token.id as string);
        if (current !== null && current !== (token.pwchg ?? null)) {
          // 清空 token 使会话失效（类型上 JWT 必须带 id，此处按约定 cast）
          return {} as typeof token;
        }
      }
      return token;
    },
  },
});
