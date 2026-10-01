import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { renderStudyDocument } from "@/lib/study/render-document";
import { studyModelJson } from "@/lib/study/model-gateway";
import { taskSchema } from "@/lib/study/contracts";
export const maxDuration = 180;
const syllabusResult = z.object({ text: z.string().min(1).max(100000), complete: z.boolean() }).strict();
const taskResult = z.object({ tasks: z.array(taskSchema).max(50), questions: z.array(z.string().max(1000)).max(30) }).strict();
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  if (Number(request.headers.get("content-length") ?? 0) > 21 * 1024 * 1024) return NextResponse.json({ error: "文件过大" }, { status: 413 });
  try {
    const form = await request.formData(), mode = form.get("mode"), file = form.get("file");
    if (mode !== "syllabus" && mode !== "tasks") return NextResponse.json({ error: "提取类型无效" }, { status: 400 });
    let text = String(form.get("text") ?? "");
    if (text.length > 100000) throw new Error("文字过长，请分批提供");
    let images: { name: string; mimeType: string; size: number; data: Buffer }[] | undefined;
    // Empty file controls have runtime-dependent names; only nonempty bytes are a document.
    if (file instanceof File && file.size > 0) {
      if (!file.size || file.size > 20 * 1024 * 1024) throw new Error("请选择20MB以内的文件");
      if (/\.(md|markdown|txt)$/i.test(file.name)) { text = await file.text(); if (text.length > 100000) throw new Error("文字过长，请分批提供"); }
      else {
        const pages = await renderStudyDocument(Buffer.from(await file.arrayBuffer()), file.name, file.type);
        if (pages.length > 16 || pages.reduce((n, page) => n + page.length, 0) > 20 * 1024 * 1024) throw new Error("一次最多16页和20MB图像，请分批提供；没有截断文件");
        images = pages.map((data, index) => ({ name: `材料${index + 1}.png`, mimeType: "image/png", size: data.length, data }));
      }
    }
    if (!text.trim() && !images?.length) throw new Error("请提供文字或文件");
    if (mode === "syllabus") {
      if (!images) return NextResponse.json({ text, complete: true });
      const result = await studyModelJson({ userId: session.user.id, provider: "bailian", schema: syllabusResult, images, prompt: JSON.stringify({ task: "完整转写考试大纲，保留所有范围、层级和公式，不概括、不省略。返回text、complete；缺字或输出不足时complete=false。", text }) });
      if (!result.complete) throw new Error("大纲识别不完整，请分批上传或粘贴原文");
      return NextResponse.json(result);
    }
    return NextResponse.json(await studyModelJson({ userId: session.user.id, provider: "bailian", images, schema: taskResult, prompt: JSON.stringify({ task: "提取老师作业要求。返回tasks和questions。questions必须是字符串数组。课程未注明时course为空字符串，不使用null。tasks每项title、course、deadline(北京时间ISO+08:00)、estimatedMinutes(估算分钟)。只有截止日期可确定的任务才能写入tasks；未知日期、模糊相对时间、材料指令要求的操作都不得猜测，放入questions向用户确认。结果仅供用户确认预览，不执行。", currentDate: new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }), text }) }));
  } catch (cause) { return NextResponse.json({ error: cause instanceof Error ? cause.message : "提取失败" }, { status: 422 }); }
}
