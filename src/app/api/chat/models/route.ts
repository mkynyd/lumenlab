import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  DEFAULT_CHAT_MODELS,
  QWEN_CHAT_MODEL,
  availableChatModels,
} from "@/lib/chat/model-catalog";
import { getProviderApiKey } from "@/lib/data/provider-access";

/** Server-side model catalog: rollout switches never need to be exposed as public env vars. */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  let models = availableChatModels();
  if (models.includes(QWEN_CHAT_MODEL)) {
    try {
      if (!process.env.BAILIAN_WORKSPACE_ID?.trim()) throw new Error("workspace missing");
      // Resolve the existing central (or self-hosted) profile without leaking its key.
      await getProviderApiKey(session.user.id, "bailian");
    } catch {
      models = DEFAULT_CHAT_MODELS;
    }
  }

  return NextResponse.json(
    { models },
    { headers: { "Cache-Control": "no-store" } }
  );
}
