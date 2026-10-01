import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createStudyImport } from "@/lib/study/imports";
export const maxDuration = 180;
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  if (Number(request.headers.get("content-length") ?? 0) > 31 * 1024 * 1024) return NextResponse.json({ error: "单个文档需在30MB以内" }, { status: 413 });
  const form = await request.formData();
  const files = form.getAll("file").filter((value): value is File => value instanceof File);
  if (!files.length) return NextResponse.json({ error: "请选择文档" }, { status: 400 });
  try { return NextResponse.json(await createStudyImport(session.user.id, files), { status: 201, headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "导入失败" }, { status: 422 }); }
}
