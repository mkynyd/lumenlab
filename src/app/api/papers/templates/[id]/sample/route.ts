import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createSignedDownloadUrl, readStoredObject } from "@/lib/storage/object-storage";
import { readTemplateSamplePdf } from "@/lib/paper/template-registry";

export async function GET(_request: Request, context: { params: Promise<unknown> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const params = await context.params;
  const id = params && typeof params === "object" && "id" in params && typeof params.id === "string" ? params.id : null;
  if (!id) return NextResponse.json({ error: "模板 Variant 参数无效" }, { status: 400 });
  const variant = await prisma.templateVariant.findUnique({ where: { id }, select: { sample: true } });
  const samplePdf = readTemplateSamplePdf(variant?.sample);
  if (!samplePdf) return NextResponse.json({ error: "模板 Sample PDF 尚未生成" }, { status: 404 });
  if (samplePdf.provider === "qiniu") {
    return NextResponse.redirect(createSignedDownloadUrl({ provider: samplePdf.provider, key: samplePdf.key, filename: "template-sample.pdf", expiresInSeconds: 600 }));
  }
  try {
    const data = await readStoredObject(samplePdf);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "inline; filename*=UTF-8''template-sample.pdf",
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch {
    return NextResponse.json({ error: "模板 Sample PDF 暂不可用" }, { status: 404 });
  }
}
