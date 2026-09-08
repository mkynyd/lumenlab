import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { safeNotificationTargetPath, toNotificationDto } from "@/lib/notifications/contracts";
import { getOwnedNotification } from "@/lib/notifications/notification-store";
import { getTaskSource } from "@/lib/tasks/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * 点击通知时的重新鉴权入口：确认通知归属当前用户，并在跳转前重新校验
 * 目标任务是否仍然可见（资源删除或权限撤销后返回 404，不泄漏旧内容）。
 * targetPath 只接受服务器生成的站内白名单路径。
 */
export async function GET(_request: Request, { params }: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  const { id } = await params;
  const row = await getOwnedNotification({
    userId: session.user.id,
    notificationId: id,
  });
  if (!row) {
    return NextResponse.json({ error: "通知不存在" }, { status: 404 });
  }

  const notification = toNotificationDto(row);
  const source = getTaskSource(row.taskType);
  const task = source
    ? await source.getOwned({ userId: session.user.id, taskId: row.taskId })
    : null;
  const targetPath = task
    ? safeNotificationTargetPath(task.resultPath)
    : safeNotificationTargetPath(notification.targetPath);

  if (!targetPath) {
    return NextResponse.json(
      { error: "结果已不可访问", notification, task: null },
      { status: 410 }
    );
  }

  return NextResponse.json({
    ok: true,
    notification,
    task,
    targetPath,
  });
}
