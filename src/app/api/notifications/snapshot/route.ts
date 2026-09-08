import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { buildNotificationSnapshot } from "@/lib/notifications/snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 轮询回退与首屏加载共用同一个投影快照；SSE 推送相同结构。 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  const snapshot = await buildNotificationSnapshot({ userId: session.user.id });
  return NextResponse.json(snapshot, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
