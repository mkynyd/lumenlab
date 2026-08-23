import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getLatestPaperCompilation, queuePaperCompilation } from "@/lib/paper/service";
import { researchErrorResponse } from "@/lib/research/http";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  try {
    const result = await queuePaperCompilation(session.user.id, (await context.params).id);
    return NextResponse.json({ compilation: result.compilation, preview: { mainTex: result.rendered.mainTex, generatedContentTex: result.rendered.generatedContentTex, nodeMap: result.rendered.nodeMap } }, { status: 202 });
  } catch (error) {
    return researchErrorResponse(error);
  }
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  try {
    const compilation = await getLatestPaperCompilation(session.user.id, (await context.params).id);
    return NextResponse.json({ compilation, pdfUrl: compilation?.status === "succeeded" || compilation?.pdfObjectKey ? `/api/papers/compilations/${compilation?.id}/pdf` : null });
  } catch (error) {
    return researchErrorResponse(error);
  }
}
