import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPaperWorkspace } from "@/lib/paper/service";
import { researchErrorResponse } from "@/lib/research/http";

/** Read-only: interactive document writing is retired; the formatting worker owns versions. */
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
