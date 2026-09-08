import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { buildNotificationSnapshot } from "@/lib/notifications/snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const POLL_MS = 2_000;
const HEARTBEAT_MS = 15_000;
/** 主动让客户端周期性重连，避免长连接被中间层静默断开。 */
const MAX_STREAM_MS = 10 * 60 * 1_000;

/**
 * owner-scoped 通知订阅。每次推送都是**权威快照**（通知 + 未读数 + 进行中任务），
 * 因此断线重连或携带 `Last-Event-ID` 重放时只需再发一次快照即可，不需要
 * 逐事件补偿；`id:` 使用快照版本，便于客户端识别是否变化。
 */
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  const userId = session.user.id;
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  const startedAt = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const finish = () => {
        if (closed) return;
        closed = true;
        if (timer) clearTimeout(timer);
        try {
          controller.close();
        } catch {
          // 连接可能已被客户端关闭。
        }
      };
      const send = (chunk: string) => {
        if (closed) return false;
        try {
          controller.enqueue(encoder.encode(chunk));
          return true;
        } catch {
          finish();
          return false;
        }
      };

      let lastVersion = "";
      let lastHeartbeat = Date.now();

      const pump = async () => {
        if (closed) return;
        if (Date.now() - startedAt > MAX_STREAM_MS) {
          finish();
          return;
        }
        try {
          const snapshot = await buildNotificationSnapshot({ userId });
          if (snapshot.version !== lastVersion) {
            lastVersion = snapshot.version;
            lastHeartbeat = Date.now();
            send(
              `id: ${encodeURIComponent(snapshot.version)}\nevent: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`
            );
          } else if (Date.now() - lastHeartbeat >= HEARTBEAT_MS) {
            lastHeartbeat = Date.now();
            send(`: heartbeat ${Date.now()}\n\n`);
          }
        } catch {
          // 单次查询失败不应断开订阅，下一轮继续。
        }
        if (!closed) timer = setTimeout(() => void pump(), POLL_MS);
      };

      const abort = () => finish();
      if (request.signal.aborted) {
        finish();
        return;
      }
      request.signal.addEventListener("abort", abort, { once: true });
      send(`: connected ${Date.now()}\n\n`);
      void pump();
    },
    cancel() {
      closed = true;
      if (timer) clearTimeout(timer);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "private, no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
