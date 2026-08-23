import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { confirmPaperImport, getPaperImport } from "@/lib/paper/service";
import { researchErrorResponse } from "@/lib/research/http";

const confirmSchema = z.object({ content: z.unknown().optional() }).strict();

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  try {
    return NextResponse.json({ import: await getPaperImport(session.user.id, (await context.params).id) });
  } catch (error) {
    return researchErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const parsed = confirmSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  try {
    return NextResponse.json({ import: await confirmPaperImport({ userId: session.user.id, importId: (await context.params).id, content: parsed.data.content }) });
  } catch (error) {
    return researchErrorResponse(error);
  }
}
