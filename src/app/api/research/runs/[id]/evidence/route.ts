import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { createUserEvidence, listResearchEvidence } from "@/lib/research/service";
import { researchErrorResponse } from "@/lib/research/http";

const evidenceSchema = z.object({
  sourceSnapshotId: z.string().trim().min(1),
  questionId: z.string().trim().min(1).nullable().optional(),
  statement: z.string().trim().min(3).max(20_000),
  excerpt: z.string().trim().min(3).max(20_000),
  locator: z.record(z.string(), z.unknown()),
  evidenceType: z.enum(["direct_quote", "paraphrase", "dataset_measurement", "project_context", "expert_assessment"]),
  tags: z.array(z.string().trim().min(1).max(80)).max(24).optional(),
}).strict();

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  try {
    return NextResponse.json({ evidence: await listResearchEvidence(session.user.id, (await context.params).id) });
  } catch (error) {
    return researchErrorResponse(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const parsed = evidenceSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  try {
    return NextResponse.json({ evidence: await createUserEvidence({ userId: session.user.id, runId: (await context.params).id, ...parsed.data }) }, { status: 201 });
  } catch (error) {
    return researchErrorResponse(error);
  }
}
