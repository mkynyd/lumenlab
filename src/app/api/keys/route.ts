import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { encrypt, maskApiKey } from "@/lib/crypto";
import { apiKeySchema } from "@/lib/validators";
import { checkRateLimit, RateLimits } from "@/lib/rate-limit";

// GET — 查询用户是否已配置 API Key（绝不返回原始密钥）
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const apiKeys = await prisma.apiKey.findMany({
    where: { userId: session.user.id },
    select: { provider: true, keyPrefix: true, createdAt: true },
  });

  return NextResponse.json({
    providers: Object.fromEntries(
      apiKeys.map((key) => [
        key.provider,
        {
          hasKey: true,
          keyPrefix: key.keyPrefix,
          createdAt: key.createdAt.toISOString(),
        },
      ])
    ),
  });
}

// POST — 保存或更新 API Key
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  const userId = session.user.id;

  // 速率限制
  const { allowed } = checkRateLimit(
    `apikey:${userId}`,
    RateLimits.API_KEY.max,
    RateLimits.API_KEY.window
  );
  if (!allowed) {
    return NextResponse.json(
      { error: "请求太频繁，请稍后重试" },
      { status: 429 }
    );
  }

  let body: { provider: "deepseek" | "minimax"; key: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "无效的 JSON 格式" }, { status: 400 });
  }

  const parsed = apiKeySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { provider } = parsed.data;
  const rawKey = parsed.data.key.trim();

  // 加密后存储
  let encryptedKey: string;
  try {
    encryptedKey = encrypt(rawKey);
  } catch {
    return NextResponse.json(
      { error: "密钥加密失败，请稍后重试" },
      { status: 500 }
    );
  }

  const keyPrefix = maskApiKey(rawKey);

  // Upsert（v1 版本每位用户仅一个 Key）
  await prisma.apiKey.upsert({
    where: { userId_provider: { userId, provider } },
    create: { userId, provider, encryptedKey, keyPrefix },
    update: { encryptedKey, keyPrefix },
  });

  return NextResponse.json({
    success: true,
    provider,
    keyPrefix,
  });
}

// DELETE — 移除 API Key
export async function DELETE(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const provider = new URL(request.url).searchParams.get("provider");
  if (provider !== "deepseek" && provider !== "minimax") {
    return NextResponse.json(
      { error: "必须指定有效的 API Key provider" },
      { status: 400 }
    );
  }

  await prisma.apiKey.deleteMany({
    where: { userId: session.user.id, provider },
  });

  return NextResponse.json({ success: true, provider });
}
