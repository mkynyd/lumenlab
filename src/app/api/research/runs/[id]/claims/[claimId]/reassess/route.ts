import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { reassessResearchClaim } from "@/lib/research/service";
import { researchErrorResponse } from "@/lib/research/http";

export async function POST(_request: Request, context: { params: Promise<{ id: string; claimId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const params = await context.params;
  try {
    return NextResponse.json(await reassessResearchClaim({ userId: session.user.id, runId: params.id, claimId: params.claimId }));
  } catch (error) {
    return researchErrorResponse(error);
  }
}
