import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { acceptDocumentPatch, rejectDocumentPatch } from "@/lib/paper/service";
import { researchErrorResponse } from "@/lib/research/http";

const decisionSchema = z.object({ decision: z.enum(["accept", "reject"]) }).strict();

export async function POST(request: Request, context: { params: Promise<{ id: string; patchId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const parsed = decisionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  const params = await context.params;
  try {
    if (parsed.data.decision === "accept") {
      return NextResponse.json({ version: await acceptDocumentPatch(session.user.id, params.patchId) });
    }
    return NextResponse.json({ patch: await rejectDocumentPatch(session.user.id, params.patchId) });
  } catch (error) {
    return researchErrorResponse(error);
  }
}
