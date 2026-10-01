import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { holidayBusyWindows } from "./holidays";
import { planStudyTime } from "./planner";
export const availabilitySchema = z.array(z.object({ start: z.iso.datetime({ offset: true }), end: z.iso.datetime({ offset: true }) }).strict().refine(window => Date.parse(window.start) < Date.parse(window.end))).min(1).max(120);
export const planningInputSchema = z.object({ availability: availabilitySchema, skipHolidays: z.boolean().default(true) }).strict();
export const planningApplySchema = z.object({ availability: availabilitySchema, skipHolidays: z.boolean().default(true), asOf: z.iso.datetime({ offset: true }), version: z.string().regex(/^[a-f0-9]{64}$/), confirmed: z.literal(true), acceptIncomplete: z.boolean().default(false) }).strict();
export async function computeStudyPlan(db: Prisma.TransactionClient, userId: string, availability: z.infer<typeof availabilitySchema>, asOf: string, skipHolidays = true) {
  const tasks = await db.studyTask.findMany({ where: { userId, completed: false }, orderBy: [{ deadline: "asc" }, { id: "asc" }], take: 501 });
  if (tasks.length > 500) throw new Error("未完成任务超过500条，请先整理任务");
  const busy = await db.studyEvent.findMany({ where: { userId, kind: { in: ["course", "study", "busy"] }, end: { gt: new Date(asOf) } }, select: { start: true, end: true, kind: true, metadata: true }, orderBy: [{ start: "asc" }, { end: "asc" }], take: 10001 });
  if (busy.length > 10000) throw new Error("日程过多，请缩小排程范围");
  const scheduled = new Map<string, number>();
  for (const event of busy) {
    if (event.kind !== "study" || !event.metadata || typeof event.metadata !== "object" || Array.isArray(event.metadata)) continue;
    const taskId = event.metadata.taskId;
    if (typeof taskId === "string") scheduled.set(taskId, (scheduled.get(taskId) ?? 0) + Math.max(0, Math.floor((event.end.getTime() - Math.max(event.start.getTime(), Date.parse(asOf))) / 60000)));
  }
  const result = planStudyTime({ now: asOf, availability, busy: [...busy.map(event => ({ start: event.start.toISOString(), end: event.end.toISOString() })), ...(skipHolidays ? holidayBusyWindows : [])], tasks: tasks.map(task => ({ id: task.id, deadline: task.deadline.toISOString(), remainingMinutes: Math.max(0, task.estimatedMinutes - (scheduled.get(task.id) ?? 0)) })) });
  const version = createHash("sha256").update(JSON.stringify({ tasks: tasks.map(task => [task.id, task.title, task.deadline.toISOString(), task.estimatedMinutes]), busy, availability, asOf, skipHolidays, result })).digest("hex");
  return { ...result, version, asOf, taskTitles: Object.fromEntries(tasks.map(task => [task.id, task.title])) };
}
