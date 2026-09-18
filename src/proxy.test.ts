import { describe, expect, it } from "vitest";
import { config } from "./proxy";

// 把 matcher 用到的子集语法（字面量段 + :path*）转成 RegExp，模拟 Next.js 的匹配语义。
function toRegExp(pattern: string): RegExp {
  const source = pattern
    .split("/")
    .filter(Boolean)
    .map((segment) => (segment === ":path*" ? "(?:/[^?#]+)*" : `/${segment}`))
    .join("");
  return new RegExp(`^${source}/?$`);
}

const matchers = (config.matcher ?? []) as string[];

function matchesAny(pathname: string): boolean {
  return matchers.some((pattern) => toRegExp(pattern).test(pathname));
}

// src/app 下全部需要认证的页面路由（对照 (chat) 路由组与侧边栏入口）。
const PROTECTED_PAGES = [
  "/chat",
  "/chat/abc123",
  "/learning",
  "/today",
  "/projects",
  "/projects/new",
  "/projects/abc123",
  "/projects/abc123/learning",
  "/projects/abc123/artifacts",
  "/research",
  "/research/abc123",
  "/papers",
  "/papers/abc123",
  "/papers/typesetting",
  "/papers/templates",
  "/papers/formatting/abc123",
  "/files",
  "/files/abc123",
  "/tools",
  "/tools/abc123",
  "/settings",
  "/usage",
  "/artifacts/abc123/print",
];

// 公开或自有鉴权的表面：法律页、认证 API、健康检查、webhook、静态资源。
// 这些刻意不在 matcher 内，匿名访问直接到达，由路由自身或跨域策略处理。
const PUBLIC_SURFACES = [
  "/legal/terms",
  "/legal/privacy",
  "/api/health",
  "/api/auth/sign-in",
  "/api/auth/providers",
  "/api/webhooks/tencent-ses",
  "/api/errors/report",
  "/qa-ai-output",
];

// landing、文档与认证页在 matcher 内是刻意的：authorized 回调依赖它们完成
// 「未登录访问受保护页 → /home」「已登录访问 /login → /chat」以及公开文档放行。
const PUBLIC_OR_AUTH_FLOW_PAGES = [
  "/",
  "/home",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/docs",
  "/docs/intro",
];

describe("proxy matcher", () => {
  it("covers every authenticated page route under src/app", () => {
    for (const pathname of PROTECTED_PAGES) {
      expect(matchesAny(pathname), pathname).toBe(true);
    }
  });

  it("keeps public and self-authenticated surfaces outside the proxy", () => {
    for (const pathname of PUBLIC_SURFACES) {
      expect(matchesAny(pathname), pathname).toBe(false);
    }
  });

  it("keeps landing, docs and auth pages matched for the public/redirect flow", () => {
    for (const pathname of PUBLIC_OR_AUTH_FLOW_PAGES) {
      expect(matchesAny(pathname), pathname).toBe(true);
    }
  });
});
