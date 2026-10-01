import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { readStoredObject } from "@/lib/storage/object-storage";
import { pageManifestSchema } from "@/lib/study/contracts";
export async function GET(_request: Request, context: { params: Promise<{ id: string; page: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { id, page } = await context.params;
  const index = Number(page);
  if (!Number.isInteger(index) || index < 0 || index > 79) return NextResponse.json({ error: "页码无效" }, { status: 400 });
  const job = await prisma.studyJob.findFirst({ where: { id, userId: session.user.id, status: "selecting", expiresAt: { gt: new Date() } } });
  if (!job) return NextResponse.json({ error: "导入不存在或已过期" }, { status: 404 });
  const manifest = pageManifestSchema.safeParse(job.payload);
  const ref = manifest.success ? manifest.data.pages[index] : undefined;
  if (!ref || !ref.key.startsWith(`study/temporary/${session.user.id}/${id}/`)) return NextResponse.json({ error: "预览不存在" }, { status: 404 });
  const buffer = await readStoredObject(ref);
  return new Response(new Uint8Array(buffer), { headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
