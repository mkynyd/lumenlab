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
 *
 * 非图片附件（PDF/文档/视频）也走同一入口展示：Content-Disposition 携带原始
 * 文件名，浏览器新标签打开时标题正确；支持 HTTP Range 单区间请求，
 * <video> 拖动进度条依赖 206 部分响应。
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
      originalName: true,
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

  const baseHeaders: Record<string, string> = {
    "Content-Type": useThumbnail ? "image/webp" : attachment.mimeType,
    // 私有缓存：浏览器可短时缓存（滚动时不重复请求），但会话/消息删除后
    // 授权失效需要尽快生效，因此不设长缓存，中间代理不得共享。
    "Cache-Control": "private, max-age=300",
    "X-Content-Type-Options": "nosniff",
    // inline 展示并回传原始文件名：新标签打开 PDF 时标签标题正确，
    // 下载按钮可用 download 属性落到同名文件。
    "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(
      attachment.originalName
    )}`,
  };

  // HTTP Range（单区间）：视频 <video> 播放拖动进度需要 206 部分响应；
  // 实现上仍读完整对象再切片，对象存储本身不支持区间读。
  const rangeHeader = request.headers.get("range");
  if (rangeHeader) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader.trim());
    const start = match ? Number(match[1]) : Number.NaN;
    const end = match
      ? match[2] === ""
        ? data.length - 1
        : Math.min(Number(match[2]), data.length - 1)
      : Number.NaN;
    if (
      Number.isInteger(start) &&
      Number.isInteger(end) &&
      start >= 0 &&
      start <= end &&
      start < data.length
    ) {
      const slice = data.subarray(start, end + 1);
      return new Response(new Uint8Array(slice), {
        status: 206,
        headers: {
          ...baseHeaders,
          "Content-Range": `bytes ${start}-${end}/${data.length}`,
          "Accept-Ranges": "bytes",
          "Content-Length": String(slice.length),
        },
      });
    }
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${data.length}` },
    });
  }

  return new Response(new Uint8Array(data), {
    headers: {
      ...baseHeaders,
      "Content-Length": String(data.length),
    },
  });
}
