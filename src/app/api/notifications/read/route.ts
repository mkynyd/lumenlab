import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { markNotificationsRead } from "@/lib/notifications/notification-store";

export const runtime = "nodejs";

/** 单条/批量已读；`{ all: true }` 表示全部已读。 */
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

  const body = payload as { ids?: unknown; all?: unknown };
  const all = body.all === true;
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
  if (!all && ids.length === 0) {
    return NextResponse.json(
      { error: "需要提供 ids 或 all: true" },
      { status: 400 }
    );
  }
  if (ids.length > 200) {
    return NextResponse.json({ error: "一次最多标记 200 条" }, { status: 400 });
  }

  const updated = await markNotificationsRead({
    userId: session.user.id,
    ids,
    all,
  });
  return NextResponse.json({ ok: true, updated });
}
