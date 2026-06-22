/**
 * POST /api/classification
 *
 * 调用 DeepSeek 进行用户身份分类，输出受 JSON Schema 严格约束的结果。
 * roleKey 必须是数据库中已启用的 UserRole.key 之一或 null。
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

export async function POST(request: Request) {
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
      { error: "参数无效", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { userInput, mode } = parsed.data;

  // 1. Build dynamic classification prompt
  const { systemPrompt, jsonSchema } = await buildClassificationPrompt(mode);

  // 2. Get provider API key
  const { getProviderApiKey } = await import("@/lib/provider-access");
  let apiKey: string;
  try {
    apiKey = await getProviderApiKey(session.user.id, "deepseek");
  } catch {
    return NextResponse.json(
      { error: "DeepSeek API Key 未配置" },
      { status: 503 }
    );
  }

  // 3. Call DeepSeek with structured output
  try {
    const client = new Anthropic({
      baseURL: DEEPSEEK_BASE_URL,
      apiKey,
      timeout: 30_000,
      maxRetries: 0,
    });

    const response = await client.messages.create({
      model: mapDeepSeekModel("deepseek-v4-flash"),
      max_tokens: 256,
      temperature: 0.1,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `用户输入：${userInput}\n\n请根据以上信息判断用户的身份角色和工作模式。`,
        },
      ],
      tools: [
        {
          name: "output_classification",
          description: "输出分类结果",
          input_schema: jsonSchema as Record<string, unknown>,
        },
      ],
      tool_choice: { type: "tool", name: "output_classification" },
    });

    // Extract structured output
    const toolBlock = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
    );
    if (!toolBlock) {
      return NextResponse.json(
        { error: "分类器未返回有效结果" },
        { status: 500 }
      );
    }

    const classification = toolBlock.input as {
      roleKey: string | null;
      mode: string;
      domain: string;
      confidence: number;
      reason: string;
    };

    // 4. Get recommended quick actions
    const quickActions = await getRecommendedQuickActions(classification.roleKey);

    return NextResponse.json({
      classification,
      quickActions,
    });
  } catch (error) {
    console.error("Classification error:", error);
    return NextResponse.json(
      { error: "分类服务暂时不可用，请稍后重试或跳过此步骤" },
      { status: 500 }
    );
  }
}
