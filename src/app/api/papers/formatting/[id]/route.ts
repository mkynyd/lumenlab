import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { researchErrorResponse } from "@/lib/research/http";
import { formattingPublicTask, formattingReview, getFormattingTask } from "@/lib/paper/formatting-service";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  try {
    const task = await getFormattingTask(session.user.id, (await context.params).id);
    return NextResponse.json({ task: formattingPublicTask(task), review: await formattingReview(session.user.id, task.id) });
  } catch (error) {
    return researchErrorResponse(error);
  }
}
