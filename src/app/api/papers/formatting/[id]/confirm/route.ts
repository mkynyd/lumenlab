import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { researchErrorResponse } from "@/lib/research/http";
import { confirmFormattingTask, formattingPublicTask } from "@/lib/paper/formatting-service";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  try {
    const task = await confirmFormattingTask(session.user.id, (await context.params).id, await request.json().catch(() => null));
    return NextResponse.json({ task: formattingPublicTask(task) });
  } catch (error) {
    return researchErrorResponse(error);
  }
}
