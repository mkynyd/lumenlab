import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getLatestPaperCompilation } from "@/lib/paper/service";
import { selectCompilationPreview } from "@/lib/paper/compilation-preview";
import { researchErrorResponse } from "@/lib/research/http";

/** Read-only compilation state. Compile jobs are queued by the formatting worker only. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  try {
    const compilation = await getLatestPaperCompilation(session.user.id, (await context.params).id);
    const preview = selectCompilationPreview(compilation.compilation, compilation.lastSuccessful);
    return NextResponse.json({
      compilation: compilation.compilation,
      lastSuccessfulCompilation: compilation.lastSuccessful,
      pdfCompilationId: preview.pdfCompilationId,
      previewSyncTex: preview.syncTex,
      pdfUrl: preview.pdfCompilationId ? `/api/papers/compilations/${preview.pdfCompilationId}/pdf` : null,
      sourceUrl: preview.pdfCompilationId ? `/api/papers/compilations/${preview.pdfCompilationId}/source` : null,
    });
  } catch (error) {
    return researchErrorResponse(error);
  }
}
