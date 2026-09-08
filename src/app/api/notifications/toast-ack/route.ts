import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { claimNotificationToasts } from "@/lib/notifications/notification-store";

export const runtime = "nodejs";

/**
 * 认领“已弹出”。多标签页并发时服务端原子更新只让一个标签页拿到这些 ID，
 * 因此同一通知只弹一次；未认领到的标签页不再重复弹出。
 * 站内推送按 at-least-once 设计：认领失败或页面关闭时通知仍在列表中。
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return NextResponse.json({ error: "请求体格式无效" }, { status: 400 });
  }

  const rawIds = (payload as { ids?: unknown }).ids;
  const ids = Array.isArray(rawIds)
    ? rawIds.filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "需要提供 ids" }, { status: 400 });
  }
  if (ids.length > 50) {
    return NextResponse.json({ error: "一次最多认领 50 条" }, { status: 400 });
  }

  const claimed = await claimNotificationToasts({
    userId: session.user.id,
    ids,
  });
  return NextResponse.json({ ok: true, claimed });
}
