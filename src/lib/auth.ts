/**
 * Auth.js 装配（Node runtime 实例）。
 *
 * 凭据校验逻辑在 `@/lib/auth/login`；本文件只负责 NextAuth 装配与 JWT 失效规则。
 * 账号主键始终是 `User.id`（绝不使用 AuthIdentity.id）；`passwordChangedAt` 是
 * 账户级密码版本，因此保留在 `User` 并通过 `pwchg` claim 让旧会话失效。
 */

import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authConfig } from "@/lib/auth.config";
import { getPasswordChangedAt } from "@/lib/password-version";
import { authorizeWithEmailPassword } from "@/lib/auth/login";

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
      authorize(credentials, request) {
        return authorizeWithEmailPassword(
          credentials,
          request as Request | undefined
        );
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
