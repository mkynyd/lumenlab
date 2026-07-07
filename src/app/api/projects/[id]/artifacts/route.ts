import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  isArtifactContentSavable,
  suggestArtifactTitle,
} from "@/lib/artifacts/content";

const ARTIFACT_TYPES = [
  "experiment_report",
  "calculation",
  "error_analysis",
  "plot_code",
  "review_outline",
  "mock_exam",
  "exam_coverage",
  "mistake_explanation",
  "quick_memory",
  "mermaid",
  "code_explanation",
  "markdown",
  "general",
] as const;

const createArtifactSchema = z.object({
  title: z.string().trim().max(150).optional(),
  type: z.enum(ARTIFACT_TYPES),
  content: z.string().min(1).max(500000),
  conversationId: z.string().optional(),
  messageId: z.string().optional(),
});

function defaultTitle(type: string) {
  const labels: Record<string, string> = {
    experiment_report: "实验报告",
    calculation: "计算过程",
    error_analysis: "误差分析",
    plot_code: "Python 绘图代码",
    review_outline: "复习提纲",
    mock_exam: "模拟试题",
    exam_coverage: "考点索引",
    mistake_explanation: "错题解析",
    quick_memory: "速记卡",
    mermaid: "思维导图",
    code_explanation: "代码说明",
  };
  return labels[type] || "AI 成果";
}

async function ownedProject(projectId: string, userId: string) {
  return prisma.project.findFirst({ where: { id: projectId, userId } });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  const { id: projectId } = await params;
  if (!(await ownedProject(projectId, session.user.id))) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  const artifacts = await prisma.artifact.findMany({
    where: { projectId, userId: session.user.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      type: true,
      format: true,
      conversationId: true,
      messageId: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return NextResponse.json({ artifacts });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  const userId = session.user.id;
  const { id: projectId } = await params;
  if (!(await ownedProject(projectId, userId))) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  const parsed = createArtifactSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  if (parsed.data.conversationId) {
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: parsed.data.conversationId,
        userId,
        projectId,
      },
    });
    if (!conversation) {
      return NextResponse.json({ error: "关联对话无效" }, { status: 400 });
    }
  }

  let messageSources: unknown = null;
  let messageContent: string | null = null;
  if (parsed.data.messageId) {
    const message = await prisma.message.findFirst({
      where: {
        id: parsed.data.messageId,
        role: "assistant",
        conversation: { userId, projectId },
      },
      select: { content: true, sources: true },
    });
    if (!message) {
      return NextResponse.json({ error: "关联消息无效" }, { status: 400 });
    }
    messageContent = message.content;
    messageSources = message.sources;
  }

  const content = messageContent ?? parsed.data.content;
  if (!isArtifactContentSavable(content)) {
    return NextResponse.json(
      { error: "这条回复还不是可保存成果，请等待 Skill 输出完成后再保存" },
      { status: 400 }
    );
  }

  const title =
    parsed.data.title?.trim() ||
    suggestArtifactTitle(content, defaultTitle(parsed.data.type));

  const artifact = await prisma.artifact.create({
    data: {
      userId,
      projectId,
      conversationId: parsed.data.conversationId || null,
      messageId: parsed.data.messageId || null,
      title,
      type: parsed.data.type,
      content,
      metadata: messageSources ? { sources: messageSources } : undefined,
    },
  });
  return NextResponse.json({ artifact }, { status: 201 });
}
