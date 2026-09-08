import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  normalizeNotificationLimit,
  toNotificationDto,
  type NotificationDto,
} from "./contracts";

type NotificationClient = Pick<PrismaClient, "notification">;
type TitleClient = Pick<PrismaClient, "agentExecution">;

type NotificationRow = {
  id: string;
  taskType: string;
  taskId: string;
  kind: string;
  title: string;
  summary: string | null;
  targetPath: string | null;
  createdAt: Date;
  readAt: Date | null;
  toastAcknowledgedAt: Date | null;
};

/**
 * 通知落库时的标题是当时可见的会话标题；会话标题是异步生成的，因此读取时
 * 优先用任务源的当前标题（同一用户可见字段），避免列表长期停留在「新对话」。
 */
async function liveTitles(
  userId: string,
  rows: NotificationRow[],
  client: TitleClient
): Promise<Map<string, string>> {
  const ids = rows
    .filter((row) => row.taskType === "agent_execution")
    .map((row) => row.taskId);
  if (ids.length === 0) return new Map();
  const executions = await client.agentExecution.findMany({
    where: { id: { in: ids }, userId },
    select: { id: true, conversation: { select: { title: true } } },
  });
  const titles = new Map<string, string>();
  for (const execution of executions) {
    const title = execution.conversation?.title?.trim();
    if (title) titles.set(execution.id, title);
  }
  return titles;
}

function toDto(
  row: NotificationRow,
  titles: Map<string, string>
): NotificationDto {
  const dto = toNotificationDto(row);
  const live = titles.get(row.taskId);
  return live ? { ...dto, title: live } : dto;
}

export interface NotificationPage {
  items: NotificationDto[];
  nextCursor: string | null;
  unreadCount: number;
}

export type NotificationFilter = "all" | "unread";

const NOTIFICATION_SELECT = {
  id: true,
  taskType: true,
  taskId: true,
  kind: true,
  title: true,
  summary: true,
  targetPath: true,
  createdAt: true,
  readAt: true,
  toastAcknowledgedAt: true,
} satisfies Prisma.NotificationSelect;

/** 游标使用 `<createdAt 毫秒>:<id>`，同一毫秒内也能稳定翻页。 */
export function encodeNotificationCursor(row: {
  createdAt: Date;
  id: string;
}): string {
  return `${row.createdAt.getTime()}:${row.id}`;
}

export function parseNotificationCursor(
  value: string | null | undefined
): { createdAt: Date; id: string } | null {
  if (!value) return null;
  const separator = value.lastIndexOf(":");
  if (separator <= 0) throw new Error("无效的通知游标");
  const millis = Number(value.slice(0, separator));
  const id = value.slice(separator + 1);
  if (!Number.isSafeInteger(millis) || millis < 0 || !id) {
    throw new Error("无效的通知游标");
  }
  return { createdAt: new Date(millis), id };
}

function cursorWhere(cursor: { createdAt: Date; id: string } | null) {
  if (!cursor) return {};
  return {
    OR: [
      { createdAt: { lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { lt: cursor.id } },
    ],
  };
}

export async function countUnread(
  userId: string,
  client: NotificationClient = prisma
): Promise<number> {
  return client.notification.count({ where: { userId, readAt: null } });
}

export async function listNotifications(input: {
  userId: string;
  filter?: NotificationFilter;
  cursor?: string | null;
  limit?: number;
  client?: NotificationClient & TitleClient;
}): Promise<NotificationPage> {
  const client = input.client ?? prisma;
  const limit = normalizeNotificationLimit(input.limit);
  const cursor = parseNotificationCursor(input.cursor);
  const where: Prisma.NotificationWhereInput = {
    userId: input.userId,
    ...(input.filter === "unread" ? { readAt: null } : {}),
    ...cursorWhere(cursor),
  };

  const rows = await client.notification.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    select: NOTIFICATION_SELECT,
  });
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const titles = await liveTitles(input.userId, page, client);

  return {
    items: page.map((row) => toDto(row, titles)),
    nextCursor: rows.length > limit && last ? encodeNotificationCursor(last) : null,
    unreadCount: await countUnread(input.userId, client),
  };
}

/** 最新一页通知（供订阅快照使用）。 */
export async function listRecentNotifications(input: {
  userId: string;
  limit?: number;
  client?: NotificationClient & TitleClient;
}): Promise<NotificationDto[]> {
  const client = input.client ?? prisma;
  const rows = await client.notification.findMany({
    where: { userId: input.userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: normalizeNotificationLimit(input.limit),
    select: NOTIFICATION_SELECT,
  });
  const titles = await liveTitles(input.userId, rows, client);
  return rows.map((row) => toDto(row, titles));
}

export async function getOwnedNotification(input: {
  userId: string;
  notificationId: string;
  client?: NotificationClient & TitleClient;
}) {
  const client = input.client ?? prisma;
  const row = await client.notification.findFirst({
    where: { id: input.notificationId, userId: input.userId },
    select: NOTIFICATION_SELECT,
  });
  if (!row) return null;
  const titles = await liveTitles(input.userId, [row], client);
  return { ...row, title: titles.get(row.taskId) ?? row.title };
}

/** 单条/批量已读；只影响属于该用户且尚未读的行。 */
export async function markNotificationsRead(input: {
  userId: string;
  ids?: string[];
  all?: boolean;
  now?: Date;
  client?: NotificationClient;
}): Promise<number> {
  const client = input.client ?? prisma;
  const now = input.now ?? new Date();
  const result = await client.notification.updateMany({
    where: {
      userId: input.userId,
      readAt: null,
      ...(input.all ? {} : { id: { in: input.ids ?? [] } }),
    },
    data: { readAt: now },
  });
  return result.count;
}

/**
 * 原子认领“已弹出”：多标签页并发调用时只有第一个请求能认领到未弹出的行，
 * 其余请求拿到空数组，因此同一通知只会弹一次。未认领成功的行仍留在列表里。
 */
export async function claimNotificationToasts(input: {
  userId: string;
  ids: string[];
  now?: Date;
  client?: NotificationClient;
}): Promise<string[]> {
  if (input.ids.length === 0) return [];
  const client = input.client ?? prisma;
  const now = input.now ?? new Date();
  const claimed = await client.notification.updateManyAndReturn({
    where: {
      userId: input.userId,
      id: { in: input.ids },
      toastAcknowledgedAt: null,
    },
    data: { toastAcknowledgedAt: now },
    select: { id: true },
  });
  return claimed.map((row) => row.id);
}
