import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { confirmResearchScope } from "@/lib/research/service";
import { researchErrorResponse } from "@/lib/research/http";

const scopeDecisionSchema = z.object({
  approved: z.boolean(),
  budgetProfile: z.enum(["quick", "deep", "comprehensive"]).optional(),
}).strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const parsed = scopeDecisionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  try {
    return NextResponse.json({
      ...await confirmResearchScope({ userId: session.user.id, runId: (await context.params).id, ...parsed.data }),
    });
  } catch (error) {
    return researchErrorResponse(error);
  }
}
