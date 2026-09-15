import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { logger } from "@/lib/logger";
import {
  FileQueryInputError,
  isFileMimeGroup,
  isFileQuerySort,
  isFileQueryStatus,
  normalizeFileQueryLimit,
  queryFiles,
  type FileMimeGroup,
  type FileQuerySort,
  type FileQueryStatus,
} from "@/lib/files/file-query";

/**
 * 跨项目文件列表。项目仍然是文件的归属边界，这里只是聚合视图：
 * 所有查询都限定在当前登录用户名下，`projectId` 只是可选的收窄条件。
 */
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const searchParams = new URL(request.url).searchParams;

  const mimeGroupParam = searchParams.get("mimeGroup");
  if (mimeGroupParam && !isFileMimeGroup(mimeGroupParam)) {
    return NextResponse.json({ error: "无效的文件类型筛选" }, { status: 400 });
  }
  const statusParam = searchParams.get("status");
  if (statusParam && !isFileQueryStatus(statusParam)) {
    return NextResponse.json({ error: "无效的解析状态筛选" }, { status: 400 });
  }
  const sortParam = searchParams.get("sort");
  if (sortParam && !isFileQuerySort(sortParam)) {
    return NextResponse.json({ error: "无效的排序方式" }, { status: 400 });
  }

  try {
    const page = await queryFiles({
      userId: session.user.id,
      q: searchParams.get("q"),
      projectId: searchParams.get("projectId"),
      category: searchParams.get("category"),
      mimeGroup: mimeGroupParam as FileMimeGroup | null,
      status: statusParam as FileQueryStatus | null,
      sort: sortParam as FileQuerySort | null,
      cursor: searchParams.get("cursor"),
      limit: normalizeFileQueryLimit(searchParams.get("limit")),
    });
    return NextResponse.json(page);
  } catch (error) {
    if (error instanceof FileQueryInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    logger.error("文件列表查询失败", {
      userId: session.user.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "查询文件失败" }, { status: 500 });
  }
}
