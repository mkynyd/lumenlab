import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  readStoredObject,
  type StorageProvider,
} from "@/lib/storage/object-storage";

/**
 * 任务 08.5：owner-scoped 消息附件响应。
 *
 * 返回同源字节而不是把七牛私有签名 URL 写进附件记录：URL 可以随时重新生成，
 * 授权始终由当前会话决定，过期与跨域都不成为问题。`variant=thumb` 读取缩略图，
 * 缩略图缺失时回退原图，避免历史行出现空白破图。
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const { id } = await params;
  const attachment = await prisma.messageAttachment.findFirst({
    where: { id, userId: session.user.id },
    select: {
      mimeType: true,
      storageProvider: true,
      storagePath: true,
      thumbnailProvider: true,
      thumbnailPath: true,
    },
  });
  if (!attachment) {
    return NextResponse.json({ error: "附件不存在" }, { status: 404 });
  }

  const wantsThumbnail = request.nextUrl.searchParams.get("variant") !== "original";
  const useThumbnail = wantsThumbnail && Boolean(attachment.thumbnailPath);
  const provider = (useThumbnail
    ? attachment.thumbnailProvider
    : attachment.storageProvider) as StorageProvider;
  const key = useThumbnail ? attachment.thumbnailPath! : attachment.storagePath;

  let data: Buffer;
  try {
    data = await readStoredObject({ provider, key });
  } catch {
    // 对象缺失或存储不可达时给出可读状态，而不是 500 或空白图。
    return NextResponse.json(
      { error: "附件已不可访问", code: "attachment_unavailable" },
      { status: 410 }
    );
  }

  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": useThumbnail ? "image/webp" : attachment.mimeType,
      // 私有缓存：浏览器可短时缓存（滚动时不重复请求），但会话/消息删除后
      // 授权失效需要尽快生效，因此不设长缓存，中间代理不得共享。
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Content-Length": String(data.length),
    },
  });
}
