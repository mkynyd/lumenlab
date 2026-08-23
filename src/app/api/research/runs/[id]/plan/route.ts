import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getResearchRun, reviseResearchPlan } from "@/lib/research/service";
import { researchErrorResponse } from "@/lib/research/http";

const reviseSchema = z.object({ directive: z.string().trim().min(1).max(4_000) }).strict();

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  try {
    const run = await getResearchRun(session.user.id, (await context.params).id);
    return NextResponse.json({ plan: run.activePlanVersion, questions: run.questions });
  } catch (error) {
    return researchErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const parsed = reviseSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  try {
    return NextResponse.json({ plan: await reviseResearchPlan({ userId: session.user.id, runId: (await context.params).id, ...parsed.data }) });
  } catch (error) {
    return researchErrorResponse(error);
  }
}
