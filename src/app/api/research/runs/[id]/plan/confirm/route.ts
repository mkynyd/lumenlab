import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { confirmResearchRunPlan } from "@/lib/research/service";
import { researchErrorResponse } from "@/lib/research/http";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  try {
    return NextResponse.json({ run: await confirmResearchRunPlan(session.user.id, (await context.params).id) });
  } catch (error) {
    return researchErrorResponse(error);
  }
}
