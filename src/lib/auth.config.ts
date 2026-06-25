import type { NextAuthConfig } from "next-auth";

export const authConfig: NextAuthConfig = {
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isAuthPage =
        nextUrl.pathname.startsWith("/login") ||
        nextUrl.pathname.startsWith("/register");
      const isApiAuth = nextUrl.pathname.startsWith("/api/auth");
      const isApi = nextUrl.pathname.startsWith("/api/");
      const isPublicPage =
        nextUrl.pathname === "/home" ||
        nextUrl.pathname.startsWith("/docs");

      // NextAuth API 永远放行
      if (isApiAuth) return true;

      // 公开页面（landing、文档）在未登录/已登录下均放行
      if (isPublicPage) return true;

      // 其他 API 路由：未登录返回 401 JSON，不做 HTML 重定向
      if (isApi) {
        if (isLoggedIn) return true;
        return new Response(
          JSON.stringify({ error: "Unauthorized" }),
          { status: 401, headers: { "content-type": "application/json" } }
        );
      }

      // /login、/register：登录用户去 /chat，未登录允许停留
      if (isAuthPage) {
        if (isLoggedIn) {
          return Response.redirect(new URL("/chat", nextUrl));
        }
        return true;
      }

      // 页面路由：未登录统一到 /home
      if (!isLoggedIn) {
        return Response.redirect(new URL("/home", nextUrl));
      }

      return true;
    },
    jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
  providers: [], // populated in auth.ts
};
