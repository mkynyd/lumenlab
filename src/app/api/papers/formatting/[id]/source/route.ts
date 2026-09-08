import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { researchErrorResponse } from "@/lib/research/http";
import { readFormattingOriginal } from "@/lib/paper/formatting-service";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  try {
    const { buffer, filename } = await readFormattingOriginal(session.user.id, (await context.params).id);
    return new NextResponse(new Uint8Array(buffer), { headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`, "Cache-Control": "private, no-store" } });
  } catch (error) {
    return researchErrorResponse(error);
  }
}
