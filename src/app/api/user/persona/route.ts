/**
 * GET/PUT /api/user/persona
 * 个性化 AI 画像三个字段（名字/职业/详情）的读取与持久化，
 * GET 同时返回已生成的 profilePrompt。
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

const personaSchema = z.object({
  profileName: z.string().max(60, "名字不能超过 60 个字符").default(""),
  profileProfession: z
    .string()
    .max(100, "职业不能超过 100 个字符")
    .default(""),
  profileDetails: z.string().max(500, "详情不能超过 500 个字符").default(""),
});

const personaSelect = {
  profileName: true,
  profileProfession: true,
  profileDetails: true,
  profilePrompt: true,
} as const;

function personaResponse(user: {
  profileName: string | null;
  profileProfession: string | null;
  profileDetails: string | null;
  profilePrompt: string | null;
}) {
  return {
    profileName: user.profileName ?? "",
    profileProfession: user.profileProfession ?? "",
    profileDetails: user.profileDetails ?? "",
    profilePrompt: user.profilePrompt ?? "",
  };
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: personaSelect,
  });
  if (!user) {
    return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  }

  return NextResponse.json(personaResponse(user));
}

export async function PUT(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式无效" }, { status: 400 });
  }

  const parsed = personaSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "参数无效" }, { status: 400 });
  }

  const user = await prisma.user.update({
    where: { id: session.user.id },
    data: {
      profileName: parsed.data.profileName.trim() || null,
      profileProfession: parsed.data.profileProfession.trim() || null,
      profileDetails: parsed.data.profileDetails.trim() || null,
    },
    select: personaSelect,
  });

  return NextResponse.json(personaResponse(user));
}
