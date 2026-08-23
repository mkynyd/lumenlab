import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { appendResearchDirective } from "@/lib/research/service";
import { researchErrorResponse } from "@/lib/research/http";

const directiveSchema = z.object({ text: z.string().trim().min(1).max(4_000) }).strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const parsed = directiveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  try {
    return NextResponse.json({ directive: await appendResearchDirective({ userId: session.user.id, runId: (await context.params).id, ...parsed.data }) }, { status: 201 });
  } catch (error) {
    return researchErrorResponse(error);
  }
}
