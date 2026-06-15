import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createTextMessage, DeepSeekError } from "@/lib/deepseek";
import type { Prisma } from "@/generated/prisma/client";
import { getProviderApiKey } from "@/lib/data/provider-access";
import { ProviderAccessError } from "@/lib/provider-access";

const ENHANCE_PROMPT = `你是大学课程资料 OCR 结果整理器。以下内容来自图片 OCR/视觉解析，可能存在识别错误。
只做结构化整理和知识增强，不要解题，不要生成最终实验报告，不要编造看不清的数据，不要把不确定内容改成确定结论。

请判断资料类型，整理可见文字，规范表格，提取公式和单位、题号和选项、实验数据字段、检索关键词和简短摘要，并列出不确定或需要用户核对的内容。
看不清或缺失的内容保留为 [无法识别]。

严格输出以下 Markdown 结构：
# 知识增强结果
## 资料类型
## 核心内容摘要
## 结构化内容
## 表格与数据
## 公式与单位
## 关键词
## 需要核对的内容`;

function metadataWith(current: unknown, next: Record<string, unknown>) {
  return {
    ...(current && typeof current === "object"
      ? (current as Prisma.InputJsonObject)
      : {}),
    ...(next as Prisma.InputJsonObject),
  } as Prisma.InputJsonObject;
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  const userId = session.user.id;
  const { id } = await params;

  const file = await prisma.fileAsset.findFirst({
    where: { id, userId },
  });
  if (!file) {
    return NextResponse.json({ error: "文件不存在" }, { status: 404 });
  }
  if (!["parsed", "partial"].includes(file.status) || !file.textContent) {
    return NextResponse.json(
      { error: "请先完成文件解析，再进行知识增强" },
      { status: 400 }
    );
  }

  let apiKey: string;
  try {
    apiKey = await getProviderApiKey(userId, "deepseek");
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof ProviderAccessError
            ? error.message
            : "服务密钥暂时不可用",
      },
      { status: 403 }
    );
  }

  await prisma.fileAsset.update({
    where: { id: file.id },
    data: { enhancementStatus: "enhancing" },
  });

  try {
    const enhancedContent = await createTextMessage(
      apiKey,
      {
        model: "deepseek-v4-flash",
        system: ENHANCE_PROMPT,
        prompt: file.textContent,
        maxTokens: 8192,
        temperature: 0.2,
      }
    );
    const enhancedAt = new Date().toISOString();
    await prisma.fileAsset.update({
      where: { id: file.id },
      data: {
        enhancedContent,
        enhancementStatus: "enhanced",
        processingMetadata: metadataWith(file.processingMetadata, {
          enhancedAt,
          enhancedByModel: "deepseek-v4-flash",
          enhanceWarnings: [],
        }),
      },
    });
    return NextResponse.json({
      success: true,
      enhancementStatus: "enhanced",
      enhancedAt,
      summary: enhancedContent.slice(0, 200),
    });
  } catch (error) {
    const message =
      error instanceof DeepSeekError
        ? error.message
        : "知识增强失败，请稍后重试";
    await prisma.fileAsset.update({
      where: { id: file.id },
      data: {
        enhancementStatus: "failed",
        processingMetadata: metadataWith(file.processingMetadata, {
          enhanceError: message.slice(0, 300),
          enhanceFailedAt: new Date().toISOString(),
        }),
      },
    });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
