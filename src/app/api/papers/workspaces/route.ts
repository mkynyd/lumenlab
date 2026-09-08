import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listPaperWorkspaces } from "@/lib/paper/service";
import { researchErrorResponse } from "@/lib/research/http";

/** Read-only list. New papers come from the formatting wizard, not blank creation. */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  try {
    return NextResponse.json({ workspaces: await listPaperWorkspaces(session.user.id) });
  } catch (error) {
    return researchErrorResponse(error);
  }
}
