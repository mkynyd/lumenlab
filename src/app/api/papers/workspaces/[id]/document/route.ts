import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { z } from "zod";
import { getPaperWorkspace, createDocumentVersion } from "@/lib/paper/service";
import { researchErrorResponse } from "@/lib/research/http";

const contentSchema = z.object({ content: z.unknown() }).strict();

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  try {
    const workspace = await getPaperWorkspace(session.user.id, (await context.params).id);
    return NextResponse.json({ document: workspace.document });
  } catch (error) {
    return researchErrorResponse(error);
  }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const parsed = contentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  try {
    const workspace = await getPaperWorkspace(session.user.id, (await context.params).id);
    if (!workspace.document) return NextResponse.json({ error: "论文文档不存在" }, { status: 404 });
    const version = await createDocumentVersion({ userId: session.user.id, documentId: workspace.document.id, content: parsed.data.content });
    return NextResponse.json({ version }, { status: 201 });
  } catch (error) {
    return researchErrorResponse(error);
  }
}
