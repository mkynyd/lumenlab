/**
 * 旧 executor.ts 的兼容层
 *
 * 现有 chat/route.ts 在 tool loop 中调用 executeSkill(name, input, context)；
 * 新架构里这套逻辑由 agent 循环负责；这里保留同名导出，避免路由立即崩，
 * 行为保持一致：调用对应工具并把结果以纯字符串形式返回。
 */

import { executeTool, hasToolHandler } from "../agent/tool-executor";
import "@/lib/tools/registry";

const NAME_TO_TOOL_ID: Record<string, string> = {
  search_project_files: "project_files.read",
  list_project_files: "project_files.list",
};

export interface SkillContext {
  userId: string;
  projectId?: string;
  conversationId?: string;
}

export async function executeSkill(
  name: string,
  input: Record<string, unknown>,
  context: SkillContext
): Promise<string> {
  const toolId = NAME_TO_TOOL_ID[name];
  if (!toolId || !hasToolHandler(toolId)) {
    return `未知工具: ${name}`;
  }
  const result = await executeTool(
    toolId,
    {
      userId: context.userId,
      conversationId: context.conversationId ?? "",
      projectId: context.projectId,
    },
    { ...input, projectId: context.projectId ?? input.projectId }
  );
  if (!result.ok) {
    return `工具执行失败: ${result.errorMessage ?? "未知错误"}`;
  }
  return JSON.stringify(result.result);
}