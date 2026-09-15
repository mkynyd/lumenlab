import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { searchGlobal } from "@/lib/search/global-search";

const MAX_QUERY_LENGTH = 100;

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const query = new URL(request.url).searchParams.get("q")?.trim() || "";
  if (!query) {
    return NextResponse.json({
      query: "",
      results: [],
      counts: { conversation: 0, image: 0, document: 0, project: 0 },
    });
  }
  if (Array.from(query).length > MAX_QUERY_LENGTH) {
    return NextResponse.json({ error: "搜索内容不能超过 100 个字符" }, { status: 400 });
  }

  try {
    return NextResponse.json(
      await searchGlobal({ userId: session.user.id, query })
    );
  } catch (error) {
    logger.error("全局搜索失败", {
      userId: session.user.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "搜索失败，请稍后重试" }, { status: 500 });
  }
}
