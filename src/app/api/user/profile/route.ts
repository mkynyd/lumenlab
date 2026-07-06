import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  AVATAR_PRESET_IDS,
  DEFAULT_AVATAR_PRESET,
  buildUserAvatarUrl,
  type AvatarPresetId,
} from "@/lib/user-profile";

const profileSchema = z.object({
  name: z.string().max(60, "昵称不能超过 60 个字符").default(""),
  avatarPreset: z.enum(AVATAR_PRESET_IDS).optional(),
});

function profileResponse(user: {
  email: string;
  name: string | null;
  avatarPreset: string | null;
  avatarObjectKey?: string | null;
  avatarUpdatedAt?: Date | string | null;
}) {
  return {
    email: user.email,
    name: user.name,
    avatarPreset: (user.avatarPreset || DEFAULT_AVATAR_PRESET) as AvatarPresetId,
    avatarUrl: buildUserAvatarUrl(user),
  };
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      email: true,
      name: true,
      avatarPreset: true,
      avatarObjectKey: true,
      avatarUpdatedAt: true,
    },
  });
  if (!user) {
    return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  }

  return NextResponse.json(profileResponse(user));
}

export async function PATCH(request: Request) {
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

  const parsed = profileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "参数无效" }, { status: 400 });
  }

  const name = parsed.data.name.trim();
  const user = await prisma.user.update({
    where: { id: session.user.id },
    data: {
      name: name || null,
      ...(parsed.data.avatarPreset ? { avatarPreset: parsed.data.avatarPreset } : {}),
    },
    select: {
      email: true,
      name: true,
      avatarPreset: true,
      avatarObjectKey: true,
      avatarUpdatedAt: true,
    },
  });

  return NextResponse.json(profileResponse(user));
}
