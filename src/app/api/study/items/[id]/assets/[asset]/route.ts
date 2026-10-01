import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { readStoredObject } from "@/lib/storage/object-storage";
const refsSchema = z.array(z.object({ key: z.string(), provider: z.enum(["local", "qiniu"]) }));
export async function GET(_request: Request, context: { params: Promise<{ id: string; asset: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { id, asset } = await context.params;
  const index = Number(asset);
  if (!Number.isInteger(index) || index < 0 || index > 31) return NextResponse.json({ error: "素材编号无效" }, { status: 400 });
  const item = await prisma.mistakeItem.findFirst({ where: { id, notebook: { collection: { userId: session.user.id } } }, select: { assets: true } });
  const parsed = refsSchema.safeParse(item?.assets);
  const ref = parsed.success ? parsed.data[index] : undefined;
  if (!ref || !ref.key.startsWith(`study/selected/${session.user.id}/${id}/`)) return NextResponse.json({ error: "素材不存在" }, { status: 404 });
  return new Response(new Uint8Array(await readStoredObject(ref)), { headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
