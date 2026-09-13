import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getResearchWorkspace, updateResearchWorkspace } from "@/lib/research/service";
import { researchErrorResponse } from "@/lib/research/http";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  description: z.string().trim().max(2_000).nullable().optional(),
  status: z.enum(["active", "archived"]).optional(),
  projectId: z.string().min(1).nullable().optional(),
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
  try {
    const workspace = await updateResearchWorkspace({ userId: session.user.id, workspaceId: (await context.params).id, ...parsed.data });
    return NextResponse.json({ workspace });
  } catch (error) {
    return researchErrorResponse(error);
  }
}
