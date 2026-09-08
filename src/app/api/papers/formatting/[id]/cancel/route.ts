import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { researchErrorResponse } from "@/lib/research/http";
import { cancelFormattingTask, getFormattingTask, formattingPublicTask } from "@/lib/paper/formatting-service";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { id } = await context.params;
  try {
    await cancelFormattingTask(session.user.id, id);
    return NextResponse.json({ task: formattingPublicTask(await getFormattingTask(session.user.id, id)) });
  } catch (error) {
    return researchErrorResponse(error);
  }
}
