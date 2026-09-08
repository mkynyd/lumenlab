import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { researchErrorResponse } from "@/lib/research/http";
import { listDocumentVersions } from "@/lib/paper/service";

/** Read-only version history. Restoring a version is no longer a user-facing write. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  try {
    return NextResponse.json({ versions: await listDocumentVersions(session.user.id, (await context.params).id) });
  } catch (error) {
    return researchErrorResponse(error);
  }
}
