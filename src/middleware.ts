import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";

export default NextAuth(authConfig).auth;

export const config = {
  matcher: [
    "/chat/:path*",
    "/settings/:path*",
    "/projects/:path*",
    "/api/chat/:path*",
    "/api/keys/:path*",
    "/api/projects/:path*",
    "/api/files/:path*",
  ],
};
