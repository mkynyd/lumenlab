import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import {
  isAdminObservabilityTimestampFresh,
  verifyAdminObservabilitySignature,
} from "@/lib/admin-observability-auth";
import {
  getAdminOverview,
  getAdminToolUsage,
  getAdminUserDetail,
  listAdminConversations,
  listAdminErrors,
  listAdminFeedback,
  listAdminMessages,
  listAdminUsers,
  updateAdminErrorStatus,
  updateAdminFeedbackStatus,
} from "@/lib/admin-observability-service";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

const READ_ACTIONS = new Set([
  "overview",
  "users",
  "user",
  "conversations",
  "messages",
  "tools",
  "feedback",
  "errors",
]);

async function authenticate(request: Request, body: string) {
  const timestamp = request.headers.get("x-admin-timestamp") ?? "";
  const nonce = request.headers.get("x-admin-nonce") ?? "";
  const signature = request.headers.get("x-admin-signature") ?? "";
  const secret = process.env.ADMIN_OBSERVABILITY_SECRET ?? "";
  const url = new URL(request.url);
  if (
    !isAdminObservabilityTimestampFresh(timestamp) ||
    !verifyAdminObservabilitySignature({
      method: request.method,
      path: `${url.pathname}${url.search}`,
      body,
      timestamp,
      nonce,
      signature,
      secret,
    })
  ) {
    return false;
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.adminObservabilityNonce.deleteMany({
        where: { expiresAt: { lte: new Date() } },
      });
      await tx.adminObservabilityNonce.create({
        data: {
          nonce,
          expiresAt: new Date(Number(timestamp) + 5 * 60_000),
        },
      });
    });
    return true;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return false;
    }
    throw error;
  }
}

async function audit(action: string, targetId?: string | null, metadata?: object) {
  await prisma.adminObservabilityAudit.create({
    data: {
      action,
      targetId: targetId || null,
      ...(metadata ? { metadata } : {}),
    },
  });
}

function unauthorized() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function GET(request: Request) {
  if (!(await authenticate(request, ""))) return unauthorized();
  const url = new URL(request.url);
  const action = url.searchParams.get("action") ?? "";
  if (!READ_ACTIONS.has(action)) {
    return NextResponse.json({ error: "无效的查询类型" }, { status: 400 });
  }

  let data: unknown;
  switch (action) {
    case "overview":
      data = await getAdminOverview();
      break;
    case "users":
      data = await listAdminUsers(url.searchParams);
      break;
    case "user": {
      const userId = url.searchParams.get("userId") ?? "";
      data = await getAdminUserDetail(userId);
      if (!data) return NextResponse.json({ error: "用户不存在" }, { status: 404 });
      break;
    }
    case "conversations":
      data = await listAdminConversations(url.searchParams);
      break;
    case "messages": {
      data = await listAdminMessages(url.searchParams);
      if (!data) return NextResponse.json({ error: "会话不存在" }, { status: 404 });
      break;
    }
    case "tools":
      data = await getAdminToolUsage(url.searchParams);
      break;
    case "feedback":
      data = await listAdminFeedback(url.searchParams);
      break;
    case "errors":
      data = await listAdminErrors(url.searchParams);
      break;
  }

  await audit(`admin.observe.${action}`, url.searchParams.get("userId") || url.searchParams.get("conversationId"), {
    limit: url.searchParams.get("limit"),
    hasCursor: Boolean(url.searchParams.get("cursor")),
  });
  return NextResponse.json({ data });
}

export async function PATCH(request: Request) {
  const body = await request.text();
  if (!(await authenticate(request, body))) return unauthorized();

  let payload: { action?: unknown; id?: unknown; status?: unknown };
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "请求格式无效" }, { status: 400 });
  }
  const action = typeof payload.action === "string" ? payload.action : "";
  const id = typeof payload.id === "string" ? payload.id : "";
  const status = typeof payload.status === "string" ? payload.status : "";
  if (!id) return NextResponse.json({ error: "缺少目标 ID" }, { status: 400 });

  const item =
    action === "feedback.status"
      ? await updateAdminFeedbackStatus(id, status)
      : action === "error.status"
        ? await updateAdminErrorStatus(id, status)
        : null;
  if (!item) return NextResponse.json({ error: "无效的状态变更" }, { status: 400 });

  await audit(`admin.observe.${action}`, id, { status });
  return NextResponse.json({ data: { id: item.id, status: item.status } });
}
