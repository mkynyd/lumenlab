import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listTemplateRegistry } from "@/lib/paper/service";
import { researchErrorResponse } from "@/lib/research/http";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const url = new URL(request.url);
  try {
    return NextResponse.json({ templates: await listTemplateRegistry({ query: url.searchParams.get("q") ?? undefined, format: url.searchParams.get("format") ?? undefined, status: url.searchParams.get("status") ?? undefined, recommendationLevel: url.searchParams.get("recommendation") ?? undefined, limit: Number(url.searchParams.get("limit") ?? 1_000) }) });
  } catch (error) {
    return researchErrorResponse(error);
  }
}
