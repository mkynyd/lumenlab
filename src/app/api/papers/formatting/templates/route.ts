import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { researchErrorResponse } from "@/lib/research/http";
import { listFormattingTemplates } from "@/lib/paper/formatting-service";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  try {
    return NextResponse.json(await listFormattingTemplates({ query: new URL(request.url).searchParams.get("q") ?? undefined }));
  } catch (error) {
    return researchErrorResponse(error);
  }
}
