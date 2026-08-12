import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { toolRegistry } from "@/lib/agent/tool-registry";
import "@/lib/tools/registry";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

type Cursor = { createdAt: string; id: string };

function pageSize(value: string | null) {
  const parsed = Number(value ?? DEFAULT_PAGE_SIZE);
  return Number.isInteger(parsed)
    ? Math.min(MAX_PAGE_SIZE, Math.max(1, parsed))
    : DEFAULT_PAGE_SIZE;
}

function decodeCursor(value: string | null): Cursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      parsed &&
      typeof parsed.createdAt === "string" &&
      typeof parsed.id === "string" &&
      Number.isFinite(new Date(parsed.createdAt).getTime())
    ) {
      return parsed;
    }
  } catch {
    // Invalid cursors fail closed to the first page.
  }
  return null;
}

function encodeCursor(value: { createdAt: Date; id: string }) {
  return Buffer.from(
    JSON.stringify({ createdAt: value.createdAt.toISOString(), id: value.id })
  ).toString("base64url");
}

function cursorWhere(cursor: Cursor | null) {
  if (!cursor) return undefined;
  const createdAt = new Date(cursor.createdAt);
  return {
    OR: [
      { createdAt: { lt: createdAt } },
      { createdAt, id: { lt: cursor.id } },
    ],
  };
}

function paged<T extends { createdAt: Date; id: string }>(rows: T[], take: number) {
  const hasMore = rows.length > take;
  const items = hasMore ? rows.slice(0, take) : rows;
  return {
    items,
    nextCursor: hasMore && items.length ? encodeCursor(items.at(-1)!) : null,
  };
}

export async function getAdminOverview() {
  const now = new Date();
  const day = new Date(now.getTime() - 24 * 60 * 60_000);
  const week = new Date(now.getTime() - 7 * 24 * 60 * 60_000);
  const month = new Date(now.getTime() - 30 * 24 * 60 * 60_000);

  const [
    totalUsers,
    newToday,
    newWeek,
    newMonth,
    activeDayRows,
    activeWeekRows,
    activeMonthRows,
    messagesToday,
    modelUsageToday,
    toolsToday,
    openFeedback,
    openErrors,
    latestUsers,
    registrationTrend,
    activityTrend,
    providerUsage,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: day } } }),
    prisma.user.count({ where: { createdAt: { gte: week } } }),
    prisma.user.count({ where: { createdAt: { gte: month } } }),
    activeUsersSince(day),
    activeUsersSince(week),
    activeUsersSince(month),
    prisma.message.count({
      where: { role: "user", createdAt: { gte: day } },
    }),
    prisma.tokenUsage.aggregate({
      where: { createdAt: { gte: day } },
      _count: true,
      _sum: { totalTokens: true, creditsConsumed: true },
    }),
    prisma.toolExecution.count({ where: { createdAt: { gte: day } } }),
    prisma.feedback.count({ where: { status: "open" } }),
    prisma.errorEvent.count({ where: { status: "open" } }),
    prisma.user.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 8,
      select: {
        id: true,
        email: true,
        name: true,
        accessStatus: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { projects: true, conversations: true } },
      },
    }),
    prisma.$queryRaw<Array<{ day: Date; count: bigint }>>(Prisma.sql`
      SELECT date_trunc('day', "createdAt") AS day, count(*)::bigint AS count
      FROM "User"
      WHERE "createdAt" >= ${month}
      GROUP BY 1 ORDER BY 1
    `),
    prisma.$queryRaw<Array<{ day: Date; users: bigint; messages: bigint }>>(Prisma.sql`
      SELECT date_trunc('day', m."createdAt") AS day,
             count(DISTINCT c."userId")::bigint AS users,
             count(*)::bigint AS messages
      FROM "Message" m
      JOIN "Conversation" c ON c.id = m."conversationId"
      WHERE m.role = 'user' AND m."createdAt" >= ${month}
      GROUP BY 1 ORDER BY 1
    `),
    prisma.tokenUsage.groupBy({
      by: ["provider", "model"],
      where: { createdAt: { gte: month } },
      _count: true,
      _sum: { totalTokens: true, creditsConsumed: true },
      orderBy: { _sum: { totalTokens: "desc" } },
    }),
  ]);

  return {
    metrics: {
      totalUsers,
      newToday,
      newWeek,
      newMonth,
      dau: activeDayRows.length,
      wau: activeWeekRows.length,
      mau: activeMonthRows.length,
      messagesToday,
      modelCallsToday: modelUsageToday._count,
      tokensToday: modelUsageToday._sum.totalTokens ?? 0,
      creditsToday: modelUsageToday._sum.creditsConsumed ?? 0,
      toolsToday,
      openFeedback,
      openErrors,
    },
    latestUsers,
    registrationTrend: registrationTrend.map((row) => ({
      day: row.day.toISOString(),
      value: Number(row.count),
    })),
    activityTrend: activityTrend.map((row) => ({
      day: row.day.toISOString(),
      users: Number(row.users),
      messages: Number(row.messages),
    })),
    providerUsage: providerUsage.map((row) => ({
      provider: row.provider,
      model: row.model,
      calls: row._count,
      tokens: row._sum.totalTokens ?? 0,
      credits: row._sum.creditsConsumed ?? 0,
    })),
  };
}

async function activeUsersSince(since: Date) {
  return prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT DISTINCT activity."userId" AS id FROM (
      SELECT c."userId" FROM "Message" m JOIN "Conversation" c ON c.id=m."conversationId"
        WHERE m.role='user' AND m."createdAt" >= ${since}
      UNION SELECT "userId" FROM "Project" WHERE "createdAt" >= ${since}
      UNION SELECT "userId" FROM "FileAsset" WHERE "createdAt" >= ${since}
      UNION SELECT "userId" FROM "Artifact" WHERE "createdAt" >= ${since}
      UNION SELECT "userId" FROM "TokenUsage" WHERE "createdAt" >= ${since}
      UNION SELECT "userId" FROM "ToolExecution" WHERE "createdAt" >= ${since}
    ) activity
  `);
}

export async function listAdminUsers(params: URLSearchParams) {
  const take = pageSize(params.get("limit"));
  const cursor = decodeCursor(params.get("cursor"));
  const search = params.get("search")?.trim().slice(0, 120);
  const status = params.get("status");
  const conditions: Prisma.UserWhereInput[] = [];
  const cursorCondition = cursorWhere(cursor);
  if (cursorCondition) conditions.push(cursorCondition);
  if (search) {
    conditions.push({
      OR: [
        { email: { contains: search, mode: "insensitive" } },
        { name: { contains: search, mode: "insensitive" } },
      ],
    });
  }
  const rows = await prisma.user.findMany({
    where: {
      ...(conditions.length ? { AND: conditions } : {}),
      ...(status === "active" || status === "revoked"
        ? { accessStatus: status }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    select: {
      id: true,
      email: true,
      name: true,
      accessStatus: true,
      planTier: true,
      creditsUsed: true,
      planCredits: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          projects: true,
          conversations: true,
          files: true,
          artifacts: true,
          tokenUsages: true,
        },
      },
    },
  });
  return paged(rows, take);
}

export async function getAdminUserDetail(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      accessStatus: true,
      emailVerifiedAt: true,
      emailVerificationSource: true,
      planTier: true,
      planCredits: true,
      creditsUsed: true,
      cycleStartedAt: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          projects: true,
          conversations: true,
          files: true,
          artifacts: true,
          tokenUsages: true,
          agentExecutions: true,
        },
      },
      tokenUsages: {
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          provider: true,
          model: true,
          totalTokens: true,
          creditsConsumed: true,
          createdAt: true,
        },
      },
    },
  });
}

export async function listAdminConversations(params: URLSearchParams) {
  const userId = params.get("userId") ?? "";
  const take = pageSize(params.get("limit"));
  const cursor = decodeCursor(params.get("cursor"));
  const kind = params.get("kind");
  const rows = await prisma.conversation.findMany({
    where: {
      userId,
      ...(cursorWhere(cursor) ?? {}),
      ...(kind === "chat"
        ? { projectId: null }
        : kind === "project"
          ? { projectId: { not: null } }
          : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    select: {
      id: true,
      title: true,
      createdAt: true,
      updatedAt: true,
      project: { select: { id: true, name: true } },
      _count: { select: { messages: true } },
    },
  });
  return paged(rows, take);
}

export async function listAdminMessages(params: URLSearchParams) {
  const conversationId = params.get("conversationId") ?? "";
  const take = pageSize(params.get("limit"));
  const cursor = decodeCursor(params.get("cursor"));
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true, title: true, project: { select: { name: true } } },
  });
  if (!conversation) return null;
  const rows = await prisma.message.findMany({
    where: {
      conversationId,
      role: { in: ["user", "assistant"] },
      ...(cursorWhere(cursor) ?? {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    select: {
      id: true,
      role: true,
      content: true,
      createdAt: true,
    },
  });
  return { conversation, ...paged(rows, take) };
}

export async function getAdminToolUsage(params: URLSearchParams) {
  const requestedDays = Number(params.get("days") ?? 30);
  const days = Number.isFinite(requestedDays)
    ? Math.min(90, Math.max(1, Math.floor(requestedDays)))
    : 30;
  const since = new Date(Date.now() - days * 24 * 60 * 60_000);
  const rows = await prisma.$queryRaw<
    Array<{
      toolId: string;
      calls: bigint;
      users: bigint;
      succeeded: bigint;
      failed: bigint;
      blocked: bigint;
      pending: bigint;
      avgMs: number | null;
      lastAt: Date;
    }>
  >(Prisma.sql`
    SELECT "toolId",
           count(*)::bigint AS calls,
           count(DISTINCT "userId")::bigint AS users,
           count(*) FILTER (WHERE status='succeeded')::bigint AS succeeded,
           count(*) FILTER (WHERE status IN ('failed','cancelled','expired'))::bigint AS failed,
           count(*) FILTER (WHERE status='blocked')::bigint AS blocked,
           count(*) FILTER (WHERE status IN ('proposed','pending_approval','approved','executing'))::bigint AS pending,
           avg(EXTRACT(EPOCH FROM (COALESCE("completedAt", "executedAt") - "createdAt")) * 1000)::float AS "avgMs",
           max("createdAt") AS "lastAt"
    FROM "ToolExecution"
    WHERE "createdAt" >= ${since}
    GROUP BY "toolId" ORDER BY calls DESC
  `);
  const usage = new Map(rows.map((row) => [row.toolId, row]));
  const toolIds = new Set([
    ...toolRegistry.list().map((tool) => tool.toolId),
    ...rows.map((row) => row.toolId),
  ]);
  return {
    days,
    items: [...toolIds]
      .map((toolId) => {
        const row = usage.get(toolId);
        const metadata = toolRegistry.get(toolId);
        return {
          toolId,
          name: metadata?.name ?? toolId,
          riskLevel: metadata?.riskLevel ?? null,
          calls: Number(row?.calls ?? 0),
          users: Number(row?.users ?? 0),
          succeeded: Number(row?.succeeded ?? 0),
          failed: Number(row?.failed ?? 0),
          blocked: Number(row?.blocked ?? 0),
          pending: Number(row?.pending ?? 0),
          avgMs: row?.avgMs ? Math.round(row.avgMs) : null,
          lastAt: row?.lastAt ?? null,
        };
      })
      .sort((a, b) => b.calls - a.calls || a.toolId.localeCompare(b.toolId)),
  };
}

export async function listAdminFeedback(params: URLSearchParams) {
  const take = pageSize(params.get("limit"));
  const cursor = decodeCursor(params.get("cursor"));
  const status = params.get("status");
  const rows = await prisma.feedback.findMany({
    where: {
      ...(cursorWhere(cursor) ?? {}),
      ...(status && ["open", "resolved", "closed"].includes(status)
        ? { status }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    select: {
      id: true,
      category: true,
      content: true,
      contact: true,
      pagePath: true,
      status: true,
      createdAt: true,
      user: { select: { id: true, email: true, name: true } },
    },
  });
  return paged(rows, take);
}

export async function listAdminErrors(params: URLSearchParams) {
  const take = pageSize(params.get("limit"));
  const cursor = decodeCursor(params.get("cursor"));
  const status = params.get("status");
  const rows = await prisma.errorEvent.findMany({
    where: {
      ...(cursor
        ? {
            OR: [
              { lastSeenAt: { lt: new Date(cursor.createdAt) } },
              {
                lastSeenAt: new Date(cursor.createdAt),
                id: { lt: cursor.id },
              },
            ],
          }
        : {}),
      ...(status && ["open", "resolved", "ignored"].includes(status)
        ? { status }
        : {}),
    },
    orderBy: [{ lastSeenAt: "desc" }, { id: "desc" }],
    take: take + 1,
    select: {
      id: true,
      digest: true,
      source: true,
      message: true,
      stack: true,
      route: true,
      status: true,
      count: true,
      firstSeenAt: true,
      lastSeenAt: true,
    },
  });
  const hasMore = rows.length > take;
  const items = hasMore ? rows.slice(0, take) : rows;
  return {
    items,
    nextCursor:
      hasMore && items.length
        ? encodeCursor({
            createdAt: items.at(-1)!.lastSeenAt,
            id: items.at(-1)!.id,
          })
        : null,
  };
}

export async function updateAdminFeedbackStatus(id: string, status: string) {
  if (!["open", "resolved", "closed"].includes(status)) return null;
  return prisma.feedback.update({ where: { id }, data: { status } });
}

export async function updateAdminErrorStatus(id: string, status: string) {
  if (!["open", "resolved", "ignored"].includes(status)) return null;
  return prisma.errorEvent.update({ where: { id }, data: { status } });
}
