import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  readStoredObject,
  readStoredObjectRange,
  type StorageProvider,
} from "@/lib/storage/object-storage";

/**
 * 同源原件读取。预览和下载都走这里，不把七牛签名 URL 交给前端：
 * 授权始终由当前会话决定，链接过期、跨域和地址外泄都不成为问题。
 *
 * 默认 `inline` 供浏览器直接预览；`?download=1` 切回 `attachment`，
 * 两种情况都用原始文件名。
 */

function contentDisposition(type: "inline" | "attachment", filename: string) {
  // 非 ASCII 文件名走 RFC 5987 的 filename*，同时保留 ASCII 兜底。
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/**
 * 只解析 `bytes=start-end` 与 `bytes=start-` 两种形式；
 * 后缀区间（`bytes=-N`）需要先知道对象长度，首版按「不带 Range」处理，
 * 返回完整内容仍是合法的响应。
 */
function parseRangeHeader(
  value: string | null
): { start: number; end: number | null } | null {
  if (!value) return null;
  const match = value.match(/^bytes=(\d+)-(\d*)$/);
  if (!match) return null;
  const start = Number(match[1]);
  if (!Number.isSafeInteger(start)) return null;
  if (!match[2]) return { start, end: null };
  const end = Number(match[2]);
  if (!Number.isSafeInteger(end) || end < start) return null;
  return { start, end };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const { id } = await params;
  const file = await prisma.fileAsset.findFirst({
    where: { id, userId: session.user.id },
    select: {
      originalName: true,
      mimeType: true,
      storageProvider: true,
      storagePath: true,
    },
  });
  if (!file) {
    return NextResponse.json({ error: "文件不存在" }, { status: 404 });
  }

  const isDownload = request.nextUrl.searchParams.get("download") === "1";
  const provider = file.storageProvider as StorageProvider;
  const baseType = file.mimeType || "application/octet-stream";
  // 文本类必须带 charset，否则用 iframe 预览中文源码会乱码。
  const contentType = /^(text\/|application\/(json|xml|javascript))/.test(baseType)
    ? `${baseType}; charset=utf-8`
    : baseType;
  const headers = {
    "Content-Type": contentType,
    "Content-Disposition": contentDisposition(
      isDownload ? "attachment" : "inline",
      file.originalName
    ),
    // 私有缓存：预览期间浏览器可复用同一份字节，但中间代理不得共享。
    "Cache-Control": "private, max-age=300",
    "X-Content-Type-Options": "nosniff",
    "Accept-Ranges": "bytes",
  };

  const range = isDownload ? null : parseRangeHeader(request.headers.get("range"));

  try {
    if (!range) {
      const data = await readStoredObject({ provider, key: file.storagePath });
      return new Response(new Uint8Array(data), {
        headers: { ...headers, "Content-Length": String(data.length) },
      });
    }

    const slice = await readStoredObjectRange({
      provider,
      key: file.storagePath,
      start: range.start,
      end: range.end,
    });
    if (range.start >= slice.totalSize) {
      return new Response(null, {
        status: 416,
        headers: { ...headers, "Content-Range": `bytes */${slice.totalSize}` },
      });
    }
    return new Response(new Uint8Array(slice.data), {
      status: 206,
      headers: {
        ...headers,
        "Content-Range": `bytes ${slice.start}-${slice.end}/${slice.totalSize}`,
        "Content-Length": String(slice.data.length),
      },
    });
  } catch {
    // 对象缺失或存储不可达：给出可读状态，而不是 500 或空白预览。
    return NextResponse.json(
      { error: "原件已不可访问", code: "file_unavailable" },
      { status: 410 }
    );
  }
}
