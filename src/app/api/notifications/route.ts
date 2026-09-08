import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import {
  listNotifications,
  type NotificationFilter,
} from "@/lib/notifications/notification-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseFilter(value: string | null): NotificationFilter {
  return value === "unread" ? "unread" : "all";
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  const url = new URL(request.url);
  const rawLimit = url.searchParams.get("limit");
  try {
    const page = await listNotifications({
      userId: session.user.id,
      filter: parseFilter(url.searchParams.get("filter")),
      cursor: url.searchParams.get("cursor"),
      limit: rawLimit === null ? undefined : Number(rawLimit),
    });
    return NextResponse.json(page);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "无效的请求参数" },
      { status: 400 }
    );
  }
}
