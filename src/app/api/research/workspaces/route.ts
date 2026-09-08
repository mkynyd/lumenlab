import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import {
  createResearchWorkspace,
  listResearchWorkspaces,
} from "@/lib/research/service";
import { researchErrorResponse } from "@/lib/research/http";

const createSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2_000).nullable().optional(),
  projectId: z.string().trim().min(1).nullable().optional(),
  domainProfileKey: z.string().trim().min(1).max(80).optional(),
  budgetProfile: z.enum(["quick", "deep", "comprehensive"]).optional(),
}).strict();

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  try {
    return NextResponse.json({ workspaces: await listResearchWorkspaces(session.user.id) });
  } catch (error) {
    return researchErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  try {
    const workspace = await createResearchWorkspace({ userId: session.user.id, ...parsed.data });
    return NextResponse.json({ workspace }, { status: 201 });
  } catch (error) {
    return researchErrorResponse(error);
  }
}
