import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";

export default NextAuth(authConfig).auth;

export const config = {
  matcher: [
    "/",
    "/login",
    "/register",
    "/forgot-password",
    "/reset-password",
    "/home",
    "/docs/:path*",
    "/learning/:path*",
    "/today/:path*",
    "/chat/:path*",
    "/files/:path*",
    "/settings/:path*",
    "/projects/:path*",
    "/research/:path*",
    "/papers/:path*",
    "/tools/:path*",
    "/usage",
    "/artifacts/:path*",
    "/api/chat/:path*",
    "/api/agent/:path*",
    "/api/learning/:path*",
    "/api/projects/:path*",
    "/api/files/:path*",
    "/api/search/:path*",
    "/api/artifacts/:path*",
    "/api/conversations/:path*",
    "/api/user/:path*",
    "/api/metrics/:path*",
  ],
};
