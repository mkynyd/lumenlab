import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { reviseResearchEvidence, updateResearchEvidenceStatus } from "@/lib/research/service";
import { researchErrorResponse } from "@/lib/research/http";

const patchSchema = z.object({
  status: z.enum(["disputed", "invalidated"]).optional(),
  statement: z.string().trim().min(3).max(20_000).optional(),
  excerpt: z.string().trim().min(3).max(20_000).optional(),
  locator: z.record(z.string(), z.unknown()).optional(),
  evidenceType: z.enum(["direct_quote", "paraphrase", "dataset_measurement", "project_context", "expert_assessment"]).optional(),
  tags: z.array(z.string().trim().min(1).max(80)).max(24).optional(),
  sourceSnapshotId: z.string().trim().min(1).optional(),
  revisionReason: z.string().trim().max(500).optional(),
}).strict();

export async function PATCH(request: Request, context: { params: Promise<{ id: string; evidenceId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  const params = await context.params;
  try {
    if (parsed.data.status) {
      if (Object.keys(parsed.data).length !== 1) return NextResponse.json({ error: "标记状态与 Evidence 修订不能在同一次请求混用" }, { status: 400 });
      return NextResponse.json({ evidence: await updateResearchEvidenceStatus({ userId: session.user.id, runId: params.id, evidenceId: params.evidenceId, status: parsed.data.status }) });
    }
    if (!parsed.data.statement || !parsed.data.excerpt || !parsed.data.locator || !parsed.data.evidenceType) {
      return NextResponse.json({ error: "Evidence 修订需要 statement、excerpt、locator 和 evidenceType" }, { status: 400 });
    }
    return NextResponse.json({ evidence: await reviseResearchEvidence({ userId: session.user.id, runId: params.id, evidenceId: params.evidenceId, ...parsed.data, statement: parsed.data.statement, excerpt: parsed.data.excerpt, locator: parsed.data.locator, evidenceType: parsed.data.evidenceType }) });
  } catch (error) {
    return researchErrorResponse(error);
  }
}
