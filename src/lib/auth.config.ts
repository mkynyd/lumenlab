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

      // Allow auth API routes
      if (isApiAuth) return true;

      if (isAuthPage) {
        if (isLoggedIn) {
          return Response.redirect(new URL("/chat", nextUrl));
        }
        return true;
      }

      if (!isLoggedIn) {
        let from = nextUrl.pathname;
        if (nextUrl.search) from += nextUrl.search;
        return Response.redirect(
          new URL(`/login?from=${encodeURIComponent(from)}`, nextUrl)
        );
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
