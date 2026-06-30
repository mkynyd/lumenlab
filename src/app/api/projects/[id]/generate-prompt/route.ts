/**
 * POST /api/projects/[id]/generate-prompt
 * 调用 LLM 生成项目级 systemPrompt 和推荐快捷任务。
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { generateProjectPrompt, generateQuickActions } from "@/lib/classification";
import { z } from "zod";

const reqSchema = z.object({
  userInput: z.string().min(2).max(500),
  mode: z.enum(["experiment", "review", "coding", "general"]),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { id: projectId } = await params;
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { userId: true } });
  if (!project || project.userId !== session.user.id) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "请求格式无效" }, { status: 400 });
  }
  const parsed = reqSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "参数无效" }, { status: 400 });
  }
  const { userInput, mode } = parsed.data;

  // Get API key
  let apiKey: string;
  try {
    const { getProviderApiKey } = await import("@/lib/data/provider-access");
    apiKey = await getProviderApiKey(session.user.id, "deepseek");
  } catch {
    return NextResponse.json({ error: "API Key 未配置" }, { status: 503 });
  }

  try {
    const [systemPrompt, quickActions] = await Promise.all([
      generateProjectPrompt(userInput, mode, apiKey),
      generateQuickActions(userInput, mode, apiKey),
    ]);

    // Update project
    await prisma.project.update({
      where: { id: projectId },
      data: { systemPrompt },
    });

    return NextResponse.json({ systemPrompt, quickActions });
  } catch (err) {
    console.error("generate-prompt error:", err);
    return NextResponse.json({ error: "生成失败，请重试" }, { status: 500 });
  }
}
