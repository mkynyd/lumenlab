import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  DEFAULT_CHAT_MODELS,
  DEFAULT_CHAT_MODEL,
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
  const unavailableReasons: Record<string, string> = {};
  if (!models.includes(QWEN_CHAT_MODEL)) {
    unavailableReasons[QWEN_CHAT_MODEL] = "Qwen 模型暂未开放，请选择其他可用模型";
  }
  if (models.includes(QWEN_CHAT_MODEL)) {
    try {
      if (!process.env.BAILIAN_WORKSPACE_ID?.trim()) {
        unavailableReasons[QWEN_CHAT_MODEL] = "Qwen 服务尚未配置百炼工作空间，请联系管理员或选择其他模型";
        throw new Error("workspace missing");
      }
      // Resolve the existing central (or self-hosted) profile without leaking its key.
      await getProviderApiKey(session.user.id, "bailian");
    } catch {
      models = DEFAULT_CHAT_MODELS;
      unavailableReasons[QWEN_CHAT_MODEL] ??= "当前账户没有可用的 Qwen 聊天凭证，请联系管理员或选择其他模型";
    }
  }

  return NextResponse.json(
    { models, defaultModel: DEFAULT_CHAT_MODEL, unavailableReasons },
    { headers: { "Cache-Control": "no-store" } }
  );
}
