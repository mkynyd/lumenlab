import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { computeStudyPlan, planningInputSchema, planningApplySchema } from "@/lib/study/planning-service";
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: "无效的时间安排" }, { status: 400 }); }
  const parsed = planningInputSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "请选择可学习时间" }, { status: 400 });
  const asOf = new Date(Math.ceil(Date.now() / 300000) * 300000).toISOString();
  try { return NextResponse.json(await computeStudyPlan(prisma, session.user.id, parsed.data.availability, asOf, parsed.data.skipHolidays)); }
  catch { return NextResponse.json({ error: "时间规划失败，请检查任务和日程" }, { status: 422 }); }
}
export async function PUT(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: "无效的规划确认" }, { status: 400 }); }
  const parsed = planningApplySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "请先预览并确认规划" }, { status: 400 });
  const input = parsed.data, age = Date.now() - Date.parse(input.asOf);
  if (age > 15 * 60000 || age < -5 * 60000) return NextResponse.json({ error: "规划预览已过期，请重新规划" }, { status: 409 });
  try {
    const count = await prisma.$transaction(async tx => {
      const plan = await computeStudyPlan(tx, session.user.id, input.availability, input.asOf, input.skipHolidays);
      if (plan.version !== input.version || plan.blocks.some(block => Date.parse(block.start) < Date.now())) throw new Error("计划发生变化，请重新预览");
      if (!plan.feasible && !input.acceptIncomplete) throw new Error("请确认无法全部完成的任务，或调整工作量后重新规划");
      if (!plan.blocks.length) throw new Error("没有可安排的学习时间");
      await tx.studyEvent.createMany({ data: plan.blocks.map(block => ({ userId: session.user.id, kind: "study", title: plan.taskTitles[block.taskId], start: new Date(block.start), end: new Date(block.end), metadata: { taskId: block.taskId, planVersion: plan.version } })) });
      await tx.studyPreferences.upsert({ where: { userId: session.user.id }, create: { userId: session.user.id, availability: input.availability }, update: { availability: input.availability } });
      return plan.blocks.length;
    }, { isolationLevel: "Serializable" });
    return NextResponse.json({ ok: true, count });
  } catch (error) { return NextResponse.json({ error: error instanceof Error && error.message.startsWith("计划发生变化") ? error.message : "规划未保存，请重新预览并检查未完成任务" }, { status: 409 }); }
}
