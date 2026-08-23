import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { importPaperDocument } from "@/lib/paper/service";
import { researchErrorResponse } from "@/lib/research/http";

const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "请选择 DOCX、Markdown、TXT 或 LaTeX 文件" }, { status: 400 });
  if (!file.name || file.size === 0) return NextResponse.json({ error: "导入文件不能为空" }, { status: 400 });
  if (file.size > MAX_IMPORT_BYTES) return NextResponse.json({ error: "导入文件不能超过 20MB" }, { status: 413 });
  try {
    const result = await importPaperDocument({
      userId: session.user.id,
      documentId: (await context.params).id,
      filename: file.name,
      buffer: Buffer.from(await file.arrayBuffer()),
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return researchErrorResponse(error);
  }
}
