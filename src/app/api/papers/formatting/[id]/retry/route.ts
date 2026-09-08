import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { researchErrorResponse } from "@/lib/research/http";
import { formattingPublicTask, retryFormattingTask } from "@/lib/paper/formatting-service";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  try {
    return NextResponse.json({ task: formattingPublicTask(await retryFormattingTask(session.user.id, (await context.params).id)) });
  } catch (error) {
    return researchErrorResponse(error);
  }
}
