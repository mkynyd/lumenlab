/**
 * POST /api/user/api-keys
 *
 * Programmatic endpoint for self-hosted deployments. Allows an authenticated
 * user to store their own provider API key. There is no frontend UI for this
 * route; developers can call it via curl or other scripts during setup.
 *
 * The route is only active when USER_API_KEYS_ENABLED is true. In the default
 * managed Alpha mode it returns 403, preventing normal users from accidentally
 * changing the deployment's key strategy.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { encrypt, maskApiKey } from "@/lib/crypto";
import { USER_API_KEYS_ENABLED } from "@/lib/config";
import type { ProviderName } from "@/lib/provider-access";

const providerSchema = z.enum(["deepseek", "minimax", "mineru", "bailian"]);

const requestSchema = z.object({
  provider: providerSchema,
  apiKey: z.string().min(1, "API Key 不能为空"),
});

export async function POST(request: Request) {
  if (!USER_API_KEYS_ENABLED) {
    return NextResponse.json(
      { error: "用户自定义 API Key 未启用" },
      { status: 403 }
    );
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式无效" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "参数无效", details: parsed.error.format() },
      { status: 400 }
    );
  }

  const { provider, apiKey } = parsed.data;
  const userId = session.user.id;

  try {
    const encryptedKey = encrypt(apiKey);
    const keyPrefix = maskApiKey(apiKey);

    await prisma.apiKey.upsert({
      where: { userId_provider: { userId, provider } },
      create: {
        userId,
        provider,
        encryptedKey,
        keyPrefix,
      },
      update: {
        encryptedKey,
        keyPrefix,
      },
    });

    return NextResponse.json({ provider, keyPrefix });
  } catch (err) {
    console.error("store-user-api-key error:", err);
    return NextResponse.json({ error: "保存失败" }, { status: 500 });
  }
}

export type StoreUserApiKeyInput = {
  provider: ProviderName;
  apiKey: string;
};
