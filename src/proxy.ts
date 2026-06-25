import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";

export default NextAuth(authConfig).auth;

export const config = {
  matcher: [
    "/",
    "/login",
    "/register",
    "/home",
    "/docs/:path*",
    "/chat/:path*",
    "/settings/:path*",
    "/projects/:path*",
    "/tools/:path*",
    "/api/chat/:path*",
    "/api/projects/:path*",
    "/api/files/:path*",
    "/api/artifacts/:path*",
    "/api/conversations/:path*",
    "/api/user/:path*",
    "/api/metrics/:path*",
  ],
};
