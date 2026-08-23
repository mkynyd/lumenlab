import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getResearchWorkspace, ResearchServiceError } from "@/lib/research/service";
import { researchErrorResponse } from "@/lib/research/http";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  description: z.string().trim().max(2_000).nullable().optional(),
  status: z.enum(["active", "archived"]).optional(),
}).strict();

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  try {
    return NextResponse.json({ workspace: await getResearchWorkspace(session.user.id, (await context.params).id) });
  } catch (error) {
    return researchErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  const id = (await context.params).id;
  const existing = await prisma.researchWorkspace.findFirst({ where: { id, userId: session.user.id }, select: { id: true } });
  if (!existing) return researchErrorResponse(new ResearchServiceError("NOT_FOUND", "研究工作区不存在或无权访问"));
  try {
    const workspace = await prisma.researchWorkspace.update({ where: { id }, data: parsed.data });
    return NextResponse.json({ workspace });
  } catch (error) {
    return researchErrorResponse(error);
  }
}
