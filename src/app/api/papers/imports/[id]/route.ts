import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPaperImport } from "@/lib/paper/service";
import { researchErrorResponse } from "@/lib/research/http";

/** Read-only import record. Structure confirmation now lives on the formatting task. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  try {
    return NextResponse.json({ import: await getPaperImport(session.user.id, (await context.params).id) });
  } catch (error) {
    return researchErrorResponse(error);
  }
}
