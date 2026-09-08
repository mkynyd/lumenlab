import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { researchErrorResponse } from "@/lib/research/http";
import { FormattingError, MAX_FORMATTING_SOURCE_BYTES } from "@/lib/paper/formatting-contracts";
import { formattingPublicTask, listFormattingTasks, submitFormattingTask } from "@/lib/paper/formatting-service";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? 50);
  try {
    return NextResponse.json({ tasks: await listFormattingTasks(session.user.id, Number.isFinite(limit) ? limit : 50) });
  } catch (error) {
    return researchErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new FormattingError("SOURCE_REQUIRED", "请上传 DOCX 或 Markdown 原稿。");
    if (file.size > MAX_FORMATTING_SOURCE_BYTES) throw new FormattingError("SOURCE_SIZE", "原稿不能超过 20 MB。");
    const raw = form.get("submission");
    if (typeof raw !== "string") throw new FormattingError("SUBMISSION_REQUIRED", "缺少模板与论文信息。");
    let submission: unknown;
    try { submission = JSON.parse(raw); } catch { throw new FormattingError("SUBMISSION_INVALID", "提交信息格式不正确。"); }
    const task = await submitFormattingTask({ userId: session.user.id, filename: file.name, buffer: Buffer.from(await file.arrayBuffer()), submission });
    return NextResponse.json({ task: formattingPublicTask(task) }, { status: 201 });
  } catch (error) {
    return researchErrorResponse(error);
  }
}
