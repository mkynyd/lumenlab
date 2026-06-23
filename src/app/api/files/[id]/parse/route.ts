import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseFileAsset } from "@/lib/files/parse-job";

export const runtime = "nodejs";
export const maxDuration = 300;

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
    select: { id: true, projectId: true },
  });
  if (!file) {
    return NextResponse.json({ error: "文件不存在" }, { status: 404 });
  }

  try {
    const result = await parseFileAsset({ userId, fileId: file.id });
    return NextResponse.json({
      file: {
        id: file.id,
        status: result.status,
        hasTextContent: true,
        parser: result.metadata.parser,
        truncated:
          "truncated" in result.metadata
            ? Boolean(result.metadata.truncated)
            : false,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "文件解析失败，请稍后重试";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
