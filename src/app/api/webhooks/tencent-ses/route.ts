import { NextResponse, type NextRequest } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { canonicalJson } from "@/lib/agent/approval-token";
import { sha256 } from "@/lib/auth-challenge";

/**
 * 腾讯云 SES 账户级回调（POST https://lab.mkynstudio.top:8080/api/webhooks/tencent-ses）。
 *
 * - 快速返回 200：腾讯云对非 200/4xx 会重推，解析失败也记日志并返回 200
 * - 幂等：事件行按 payloadHash（sha256(canonicalJson(payload))）唯一，重复回调零写入
 * - 按 bulkId（SendEmail 返回的 MessageId）关联 EmailLog 更新投递状态机；
 *   未命中时建 callback-only 占位行便于排查，不阻断
 * - 同一封邮件可能多次回调（delivered 后又收到 bounce 等），终态不可被低优先级覆盖
 * - 无鉴权机制：按不可信输入处理（仅解析 + 存储，限制请求体大小）
 */

const MAX_BODY_BYTES = 64 * 1024;

// 状态机优先级（仅这 5 类更新 EmailLog.event；open/click/unsubscribe 只写事件行）
const TERMINAL_PRIORITY = 10; // dropped / spamreport / hard_bounce
const SOFT_BOUNCE_PRIORITY = 5;
const DELIVERED_PRIORITY = 2;
const DEFERRED_PRIORITY = 1;

function currentEventPriority(event: string | null, bounceType: string | null): number {
  switch (event) {
    case "dropped":
    case "spamreport":
      return TERMINAL_PRIORITY;
    case "bounced":
      return bounceType === "hard_bounce" ? TERMINAL_PRIORITY : SOFT_BOUNCE_PRIORITY;
    case "delivered":
      return DELIVERED_PRIORITY;
    case "deferred":
      return DEFERRED_PRIORITY;
    default:
      return 0; // sending / sent / failed / callback-only
  }
}

function incomingPriority(
  event: string | undefined,
  bounceType: string | undefined
): number {
  switch (event) {
    case "dropped":
    case "spamreport":
      return TERMINAL_PRIORITY;
    case "bounce":
      return bounceType === "hard_bounce" ? TERMINAL_PRIORITY : SOFT_BOUNCE_PRIORITY;
    case "delivered":
      return DELIVERED_PRIORITY;
    case "deferred":
      return DEFERRED_PRIORITY;
    default:
      return 0; // open / click / unsubscribe —— 不更新状态机
  }
}

/** 回调 event → EmailLog.event（仅状态机事件；bounceType 细节在数据中保留） */
function mapEvent(event: string | undefined): string | null {
  switch (event) {
    case "delivered":
      return "delivered";
    case "deferred":
      return "deferred";
    case "bounce":
      return "bounced";
    case "dropped":
      return "dropped";
    case "spamreport":
      return "spamreport";
    default:
      return null;
  }
}

export async function POST(request: NextRequest) {
  // 体积限制：超限只记日志，仍快速 200 避免腾讯云重推
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) {
    console.warn("[tencent-ses-webhook] body too large", contentLength);
    return NextResponse.json({ ok: true });
  }

  let payload: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) {
      console.warn("[tencent-ses-webhook] body too large", text.length);
      return NextResponse.json({ ok: true });
    }
    payload = JSON.parse(text);
  } catch {
    console.warn("[tencent-ses-webhook] invalid JSON");
    return NextResponse.json({ ok: true });
  }

  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    console.warn("[tencent-ses-webhook] unexpected payload shape");
    return NextResponse.json({ ok: true });
  }

  const record = payload as Record<string, unknown>;
  const event = typeof record.event === "string" ? record.event : undefined;
  const email = typeof record.email === "string" ? record.email : undefined;
  const bulkId = typeof record.bulkId === "string" ? record.bulkId : undefined;
  const bounceType =
    typeof record.bounceType === "string" ? record.bounceType : undefined;
  const reason = typeof record.reason === "string" ? record.reason : undefined;
  const smtpMessageId =
    typeof record.messageId === "string" ? record.messageId : undefined;

  // 幂等落点：事件行 payloadHash 唯一，重复回调零写入
  const payloadHash = sha256(canonicalJson(record));
  await prisma.emailLogEvent.createMany({
    data: [
      {
        emailLogId: null,
        event: event ?? "unknown",
        payload: record as Prisma.InputJsonValue,
        payloadHash,
      },
    ],
    skipDuplicates: true,
  });

  // 按 bulkId 关联 EmailLog（未命中则建占位行，不阻断）
  const mappedEvent = mapEvent(event);
  const priority = incomingPriority(event, bounceType);

  if (bulkId) {
    const log = await prisma.emailLog.findFirst({
      where: { bulkId },
      select: { id: true, event: true, bounceType: true },
    });
    if (log) {
      // 读改写存在极小竞态窗口（审计场景可接受）：终态不会被低优先级覆盖；
      // smtpMessageId 随状态机更新一并写入（首次 delivered 时即完成）
      if (mappedEvent && priority > currentEventPriority(log.event, log.bounceType)) {
        await prisma.emailLog.update({
          where: { id: log.id },
          data: {
            event: mappedEvent,
            ...(bounceType ? { bounceType } : {}),
            ...(reason ? { reason } : {}),
            ...(smtpMessageId ? { smtpMessageId } : {}),
          },
        });
      }
      if (log.id) {
        await prisma.emailLogEvent.updateMany({
          where: { payloadHash },
          data: { emailLogId: log.id },
        });
      }
    } else if (mappedEvent) {
      const placeholder = await prisma.emailLog.create({
        data: {
          kind: "callback",
          email: email ?? "unknown",
          bulkId,
          ...(smtpMessageId ? { smtpMessageId } : {}),
          event: "callback-only",
          ...(bounceType ? { bounceType } : {}),
          ...(reason ? { reason } : {}),
          payload: record as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      await prisma.emailLogEvent.updateMany({
        where: { payloadHash },
        data: { emailLogId: placeholder.id },
      });
    }
  }

  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({ error: "Method Not Allowed" }, { status: 405 });
}

export async function PUT() {
  return NextResponse.json({ error: "Method Not Allowed" }, { status: 405 });
}
