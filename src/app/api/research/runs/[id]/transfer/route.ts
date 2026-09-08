import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { listResearchTransferCandidates, transferResearchMaterials } from "@/lib/paper/service";
import { researchErrorResponse } from "@/lib/research/http";

const transferSchema = z.object({
  paperWorkspaceId: z.string().trim().min(1),
  sourceIds: z.array(z.string().trim().min(1)).max(200).optional(),
  claimIds: z.array(z.string().trim().min(1)).max(200).optional(),
  evidenceIds: z.array(z.string().trim().min(1)).max(200).optional(),
}).strict();

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  try {
    return NextResponse.json({ candidates: await listResearchTransferCandidates(session.user.id, (await context.params).id) });
  } catch (error) {
    return researchErrorResponse(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const parsed = transferSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  try {
    return NextResponse.json({ transfer: await transferResearchMaterials({ userId: session.user.id, researchRunId: (await context.params).id, ...parsed.data }) });
  } catch (error) {
    return researchErrorResponse(error);
  }
}
