import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getResearchWorkspace, createResearchRun, ResearchServiceError } from "@/lib/research/service";
import { researchErrorResponse } from "@/lib/research/http";

const createSchema = z.object({
  question: z.string().trim().min(3).max(20_000),
  budgetProfile: z.enum(["quick", "deep", "comprehensive"]).optional(),
}).strict();

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  try {
    const workspace = await getResearchWorkspace(session.user.id, (await context.params).id);
    return NextResponse.json({ runs: workspace.runs });
  } catch (error) {
    return researchErrorResponse(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  const workspaceId = (await context.params).id;
  try {
    const run = await createResearchRun({ userId: session.user.id, workspaceId, ...parsed.data });
    return NextResponse.json({ run }, { status: 201 });
  } catch (error) {
    return researchErrorResponse(error instanceof ResearchServiceError ? error : error);
  }
}
