/**
 * POST /api/user/password
 * 登录态修改密码：校验当前密码后更新 passwordHash + passwordChangedAt
 * （旧 JWT 经 pwchg claim 失效），并删除 Redis pwchg 缓存避免旧会话残留。
 */

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkRateLimit, RateLimits } from "@/lib/rate-limit";
import { passwordResetRepository } from "@/lib/data/password-reset-repository";
import { invalidatePasswordChangedAtCache } from "@/lib/password-version";

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "请输入当前密码").max(128),
  newPassword: z.string().min(8, "密码至少需要 8 个字符").max(128),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const forwardedFor = request.headers.get("x-forwarded-for");
  const ip = forwardedFor?.split(",")[0]?.trim() || "unknown";

  const { allowed } = await checkRateLimit(
    `password-change:${ip}`,
    RateLimits.PASSWORD_CHANGE_IP.max,
    RateLimits.PASSWORD_CHANGE_IP.window
  );
  if (!allowed) {
    return NextResponse.json(
      { error: "请求太频繁，请稍后再试" },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式无效" }, { status: 400 });
  }

  const parsed = changePasswordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "参数无效" }, { status: 400 });
  }

  const { currentPassword, newPassword } = parsed.data;

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { passwordHash: true },
  });
  if (!user) {
    return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  }

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) {
    return NextResponse.json({ error: "当前密码不正确" }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await passwordResetRepository.updatePassword(
    session.user.id,
    passwordHash,
    new Date()
  );
  await invalidatePasswordChangedAtCache(session.user.id);

  return NextResponse.json({ success: true });
}
