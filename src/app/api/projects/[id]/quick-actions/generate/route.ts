import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createTextMessage } from "@/lib/deepseek";
import { getProviderApiKey } from "@/lib/data/provider-access";

const generateQuickActionSchema = z.object({
  description: z.string().min(2).max(2000),
});

function titleFallback(description: string) {
  return description.replace(/\s+/g, "").slice(0, 6) || "快捷操作";
}

function parseGeneratedAction(output: string, description: string) {
  try {
    const json = output.match(/\{[\s\S]*\}/)?.[0] || output;
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const title =
      typeof parsed.title === "string" && parsed.title.trim()
        ? parsed.title.trim().slice(0, 6)
        : titleFallback(description);
    const prompt =
      typeof parsed.prompt === "string" && parsed.prompt.trim()
        ? parsed.prompt.trim()
        : description.trim();
    return { title, prompt };
  } catch {
    return { title: titleFallback(description), prompt: description.trim() };
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  const { id: projectId } = await params;
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: session.user.id },
    select: { id: true, type: true },
  });
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  const parsed = generateQuickActionSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  let generated = {
    title: titleFallback(parsed.data.description),
    prompt: parsed.data.description.trim(),
  };
  try {
    const apiKey = await getProviderApiKey(session.user.id, "deepseek");
    const output = await createTextMessage(apiKey, {
      model: "deepseek-v4-flash",
      temperature: 0.2,
      maxTokens: 1000,
      system:
        "你是大学课程 AI 工作台的快捷操作设计器。只输出 JSON，不要解释。",
      prompt:
        `项目类型：${project.type}\n` +
        `用户描述：${parsed.data.description}\n\n` +
        `请生成 {"title":"不超过6个中文字符","prompt":"完整结构化提示词"}。提示词必须要求只基于项目资料回答，资料不足时说明缺失，不要编造。`,
    });
    generated = parseGeneratedAction(output, parsed.data.description);
  } catch {
    generated = parseGeneratedAction("", parsed.data.description);
  }

  return NextResponse.json({ quickAction: generated });
}
