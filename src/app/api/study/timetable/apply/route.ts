import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { timetableApplySchema } from "@/lib/study/calendar-contracts";
import { expandTimetable } from "@/lib/study/timetable";
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: "无效的课表数据" }, { status: 400 }); }
  const parsed = timetableApplySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "请确认课表内容及节次时间" }, { status: 400 });
  try {
    const input = parsed.data;
    const expanded = input.patterns.length ? expandTimetable(input) : [];
    const events = [...input.events, ...expanded];
    if (!events.length || events.length > 2000) throw new Error("课表课程数量为空或超过2000条");
    const userId = session.user.id;
    const added = await prisma.$transaction(async tx => {
      if (input.replace) await tx.studyEvent.deleteMany({ where: { userId, kind: "course" } });
      const existing = await tx.studyEvent.findMany({ where: { userId, kind: "course" }, select: { title: true, start: true, end: true } });
      const keys = new Set(existing.map(event => `${event.title}:${event.start.toISOString()}:${event.end.toISOString()}`));
      const data = [];
      for (const event of events) {
        const start = new Date(event.start), end = new Date(event.end);
        const key = `${event.title}:${start.toISOString()}:${end.toISOString()}`;
        if (keys.has(key)) continue;
        keys.add(key);
        data.push({ userId, title: event.title, kind: "course", start, end, metadata: { location: event.location } });
      }
      if (data.length) await tx.studyEvent.createMany({ data });
      await tx.studyPreferences.upsert({ where: { userId }, create: { userId, periods: input.periods, termStart: input.patterns.length ? new Date(`${input.termStart}T00:00:00+08:00`) : null }, update: { ...(input.patterns.length ? { periods: input.periods, termStart: new Date(`${input.termStart}T00:00:00+08:00`) } : {}) } });
      return data.length;
    }, { isolationLevel: "Serializable" });
    return NextResponse.json({ ok: true, count: added });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "课表保存失败" }, { status: 422 }); }
}
