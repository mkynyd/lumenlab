import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { updateResearchClaim } from "@/lib/research/service";
import { researchErrorResponse } from "@/lib/research/http";

const patchSchema = z.object({ statement: z.string().trim().min(3).max(20_000) }).strict();

export async function PATCH(request: Request, context: { params: Promise<{ id: string; claimId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  const params = await context.params;
  try {
    return NextResponse.json({ claim: await updateResearchClaim({ userId: session.user.id, runId: params.id, claimId: params.claimId, ...parsed.data }) });
  } catch (error) {
    return researchErrorResponse(error);
  }
}
