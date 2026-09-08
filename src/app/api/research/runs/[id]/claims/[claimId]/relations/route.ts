import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { upsertClaimEvidenceRelation } from "@/lib/research/service";
import { researchErrorResponse } from "@/lib/research/http";

const relationSchema = z.object({
  evidenceId: z.string().trim().min(1),
  relation: z.enum(["supports", "contradicts", "qualifies", "context"]),
  confidence: z.number().min(0).max(1).optional(),
  rationale: z.string().trim().max(2_000).nullable().optional(),
}).strict();

export async function POST(request: Request, context: { params: Promise<{ id: string; claimId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const parsed = relationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  const params = await context.params;
  try {
    return NextResponse.json({ relation: await upsertClaimEvidenceRelation({ userId: session.user.id, runId: params.id, claimId: params.claimId, ...parsed.data }) });
  } catch (error) {
    return researchErrorResponse(error);
  }
}
