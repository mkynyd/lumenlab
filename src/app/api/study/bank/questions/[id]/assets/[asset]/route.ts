import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { readStoredObject } from "@/lib/storage/object-storage";
const schema = z.array(z.object({ provider: z.enum(["local", "qiniu"]), key: z.string() })).max(32);
export async function GET(_request: Request, context: { params: Promise<{ id: string; asset: string }> }) {
  if (!(await auth())?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { id, asset } = await context.params;
  const question = await prisma.bankQuestion.findFirst({ where: { id, verified: true, paper: { verified: true } }, select: { paperId: true, assets: true } });
  const parsed = schema.safeParse(question?.assets);
  const ref = /^\d+$/.test(asset) && parsed.success ? parsed.data[Number(asset)] : null;
  if (!question || !ref || !ref.key.startsWith(`study/bank/${question.paperId}/${id}/`)) return NextResponse.json({ error: "插图不存在" }, { status: 404 });
  try { return new Response(new Uint8Array(await readStoredObject(ref)), { headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } }); }
  catch { return NextResponse.json({ error: "插图读取失败" }, { status: 404 }); }
}
