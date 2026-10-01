import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { submitSelectedMistakes } from "@/lib/study/selected-import";
export const maxDuration = 180;
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { id } = await context.params;
  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: "无效的选题数据" }, { status: 400 }); }
  try { return NextResponse.json(await submitSelectedMistakes(session.user.id, id, raw), { status: 202 }); }
  catch { return NextResponse.json({ error: "选题保存失败，请检查错题本和选框后重试" }, { status: 422 }); }
}
