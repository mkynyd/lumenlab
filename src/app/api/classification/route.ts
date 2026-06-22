/**
 * POST /api/classification
 *
 * 调用 DeepSeek 进行用户身份分类。使用纯文本 JSON 响应用于最大兼容性。
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { buildClassificationPrompt, getRecommendedQuickActions } from "@/lib/classification";
import { mapDeepSeekModel } from "@/lib/deepseek";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

const DEEPSEEK_BASE_URL = "https://api.deepseek.com/anthropic";

const requestSchema = z.object({
  userInput: z.string().min(2).max(500),
  mode: z.enum(["experiment", "review", "coding", "general"]).default("general"),
});

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  // Auth
  const session = await auth();
  if (!session?.user?.id) {
    return errorResponse("未登录", 401);
  }

  // Parse body
  let body: unknown;
  try { body = await request.json(); } catch {
    return errorResponse("请求格式无效", 400);
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("参数无效", 400);
  }
  const { userInput, mode } = parsed.data;

  // Build classification prompt
  const { systemPrompt, jsonSchema, roleKeys } = await buildClassificationPrompt(mode);
  if (roleKeys.length === 0) {
    return NextResponse.json({
      classification: { roleKey: null, mode, domain: "通用", confidence: 0, reason: "no_roles" },
      quickActions: [],
    });
  }

  // Get API key
  let apiKey: string;
  try {
    const mod = await import("@/lib/data/provider-access");
    apiKey = await mod.getProviderApiKey(session.user.id, "deepseek");
  } catch {
    return errorResponse("DeepSeek API Key 未配置", 503);
  }

  // Call DeepSeek
  const schemaStr = JSON.stringify(jsonSchema);
  let text: string;
  try {
    const client = new Anthropic({ baseURL: DEEPSEEK_BASE_URL, apiKey, timeout: 30_000, maxRetries: 0 });
    const response = await client.messages.create({
      model: mapDeepSeekModel("deepseek-v4-flash"),
      max_tokens: 256,
      temperature: 0.1,
      system: systemPrompt,
      messages: [{ role: "user", content: `用户输入：${userInput}\n\n输出严格符合以下 JSON Schema 的 JSON 对象，不要输出其他内容：\n${schemaStr}` }],
    });
    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || !("text" in textBlock)) {
      return errorResponse("分类器返回为空", 500);
    }
    text = textBlock.text;
  } catch (err) {
    console.error("DeepSeek classification call failed:", err instanceof Error ? err.message : String(err));
    return errorResponse("分类服务暂不可用", 500);
  }

  // Parse JSON response
  let classification: { roleKey: string | null; mode: string; domain: string; confidence: number; reason: string };
  try {
    const cleaned = text.replace(/```json\n?/g, "").replace(/```/g, "").trim();
    classification = JSON.parse(cleaned);
  } catch {
    console.error("Classification JSON parse failed, raw text:", text.slice(0, 200));
    return errorResponse("分类器返回格式异常", 500);
  }

  // Validate
  if (classification.roleKey && !roleKeys.includes(classification.roleKey)) {
    classification.roleKey = null;
  }
  if (!["experiment", "review", "coding", "general"].includes(classification.mode)) {
    classification.mode = mode;
  }
  if (typeof classification.domain !== "string") classification.domain = "通用";
  if (typeof classification.confidence !== "number") classification.confidence = 0;

  // Recommend quick actions
  const quickActions = await getRecommendedQuickActions(classification.roleKey);

  return NextResponse.json({ classification, quickActions });
}
