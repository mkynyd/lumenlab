import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { generatePaperDocumentPatch } from "@/lib/paper/ai-assistant";
import { researchErrorResponse } from "@/lib/research/http";

const assistantSchema = z.object({ instruction: z.string().trim().min(3).max(4_000) }).strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const parsed = assistantSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  try {
    return NextResponse.json({ patch: await generatePaperDocumentPatch({ userId: session.user.id, documentId: (await context.params).id, instruction: parsed.data.instruction }) }, { status: 201 });
  } catch (error) {
    return researchErrorResponse(error);
  }
}
